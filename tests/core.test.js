import { test } from "node:test";
import assert from "node:assert/strict";
import { resetAll } from "../src/resetAll.js";
import { decide } from "../src/decision.js";
import { resolveCluster, normalizeEmail } from "../src/cluster.js";
import { reconcile } from "../src/reconciler.js";
import { recordVendorUsage } from "../src/vendorMock.js";
import { investigate } from "../src/investigator.js";
import { ingestKnowledgeBase } from "../src/rag/ingest.js";


test("normalize gmail dots and plus tags", () => {
  assert.equal(normalizeEmail("b.o.t+x@gmail.com"), "bot@gmail.com");
});

test("shared device fingerprint becomes one cluster", async () => {
  await resetAll();
  const a = resolveCluster("a1", { deviceFingerprint: "fp-1" });
  const b = resolveCluster("a2", { deviceFingerprint: "fp-1" });
  assert.equal(a, b);
});

test("unpaid cluster hits $5 ceiling", async () => {
  await resetAll();
  let last;
  for (let i = 0; i < 80; i++) {
    last = await decide({
      actorId: "bot",
      action: "sms.send",
      paid: false,
      signals: { deviceFingerprint: "fp-ceiling" },
    });
    if (last.decision === "DENY") break;
  }
  assert.equal(last.decision, "DENY");
  assert.ok(last.spendBefore <= 5);
});

test("paid cluster gets higher ceiling than unpaid", async () => {
  await resetAll();
  const unpaid1 = await decide({
    actorId: "free-1",
    action: "payment.attempt",
    paid: false,
    signals: { deviceFingerprint: "fp-free" },
  });
  assert.equal(unpaid1.decision, "ALLOW");
  const unpaid2 = await decide({
    actorId: "free-1",
    action: "payment.attempt",
    paid: false,
    signals: { deviceFingerprint: "fp-free" },
  });
  assert.equal(unpaid2.decision, "DENY");

  await resetAll();
  const paid1 = await decide({
    actorId: "paid-1",
    action: "payment.attempt",
    paid: true,
    signals: { deviceFingerprint: "fp-paid" },
  });
  assert.equal(paid1.decision, "ALLOW");
  assert.equal(paid1.ceilingUsd, 50);
  const paid2 = await decide({
    actorId: "paid-1",
    action: "payment.attempt",
    paid: true,
    signals: { deviceFingerprint: "fp-paid" },
  });
  assert.equal(paid2.decision, "ALLOW");
});

test("idempotencyKey prevents double charge on auto decide", async () => {
  await resetAll();
  const key = "idem-demo-1";
  const a = await decide({
    actorId: "idem-user",
    action: "payment.attempt",
    paid: false,
    idempotencyKey: key,
    signals: { deviceFingerprint: "fp-idem" },
  });
  const b = await decide({
    actorId: "idem-user",
    action: "payment.attempt",
    paid: false,
    idempotencyKey: key,
    signals: { deviceFingerprint: "fp-idem" },
  });
  assert.equal(a.decision, "ALLOW");
  assert.equal(b.replay, true);
  assert.equal(a.spendAfter, b.spendAfter);
});

test("ghost spend disables key", async () => {
  await resetAll();
  await decide({
    actorId: "u1",
    action: "llm.call",
    paid: true,
    vendorKeyId: "gm-demo-key",
  });
  recordVendorUsage("gm-demo-key", 10);
  const report = reconcile({ keyId: "gm-demo-key" });
  assert.equal(report.results[0].ghostDetected, true);
  assert.equal(report.results[0].keyStatus, "disabled");

  const blocked = await decide({
    actorId: "u1",
    action: "llm.call",
    paid: true,
    vendorKeyId: "gm-demo-key",
  });
  assert.equal(blocked.decision, "DENY");
});

test("investigator writes a readable summary", async () => {
  await resetAll();
  await ingestKnowledgeBase();
  await decide({
    actorId: "u1",
    action: "llm.call",
    paid: true,
    vendorKeyId: "gm-demo-key",
  });
  recordVendorUsage("gm-demo-key", 20);
  reconcile({ keyId: "gm-demo-key" });
  await ingestKnowledgeBase();
  const report = await investigate();
  assert.match(report.summary, /ghost/i);
  assert.ok(report.citations.length > 0);
});

test("rule mode change writes an audit row", async () => {
  await resetAll();
  const { setRuleMode } = await import("../src/rules/store.js");
  const { listAudits } = await import("../src/auditLog.js");
  const { snapshot } = await import("../src/metrics.js");

  setRuleMode("R-otp-country", "enforce", { actor: "test-runner" });
  const audits = listAudits({ limit: 5 });
  assert.equal(audits[0].action, "rule.mode_change");
  assert.equal(audits[0].actor, "test-runner");
  assert.equal(audits[0].target, "R-otp-country");
  assert.ok(snapshot().rule_mode_changes >= 1);
});



