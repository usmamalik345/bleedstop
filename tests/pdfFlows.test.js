import { test } from "node:test";
import assert from "node:assert/strict";
import { resetAll } from "../src/resetAll.js";
import { decide } from "../src/decision.js";
import { fallbackDecision } from "../src/failPolicy.js";
import { freezeOtp } from "../src/runbooks.js";
import { billShockAudit } from "../src/audit/billShock.js";
import { runDrill } from "../src/drill/scenarios.js";
import { recordVendorUsage } from "../src/vendorMock.js";

test("disposable signup is CHALLENGE and does not spend", async () => {
  await resetAll();
  const row = await decide({
    actorId: "newbie",
    action: "signup.create",
    paid: false,
    signals: { deviceFingerprint: "fp-new", email: "a@mailinator.com" },
  });
  assert.equal(row.decision, "CHALLENGE");
  assert.equal(row.spendAfter, 0);
});

test("fail policy: SMS closed, login open, LLM local cap", () => {
  assert.equal(fallbackDecision("sms.send").decision, "DENY");
  assert.equal(fallbackDecision("auth.login").decision, "ALLOW");
  assert.equal(fallbackDecision("llm.call").decision, "LIMIT");
});

test("OTP freeze runbook blocks sms", async () => {
  await resetAll();
  const first = await decide({
    actorId: "u-otp",
    action: "sms.send",
    paid: false,
    signals: { deviceFingerprint: "fp-otp-freeze" },
  });
  assert.equal(first.decision, "ALLOW");
  freezeOtp(first.clusterId, { actor: "test" });
  const blocked = await decide({
    actorId: "u-otp",
    action: "sms.send",
    paid: false,
    signals: { deviceFingerprint: "fp-otp-freeze" },
  });
  assert.equal(blocked.decision, "DENY");
  assert.match(blocked.reason, /frozen/i);
});

test("parallel card tests only charge once", async () => {
  await resetAll();
  const rows = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      decide({
        actorId: `r${i}`,
        action: "payment.attempt",
        paid: false,
        signals: { deviceFingerprint: "fp-one-cluster" },
      })
    )
  );
  const allows = rows.filter((r) => r.decision === "ALLOW");
  assert.equal(allows.length, 1);
});

test("bill-shock audit sees ghost gap", async () => {
  await resetAll();
  await decide({
    actorId: "u",
    action: "llm.call",
    paid: true,
    vendorKeyId: "gm-demo-key",
  });
  recordVendorUsage("gm-demo-key", 10);
  const audit = billShockAudit();
  assert.ok(audit.ghostSpendUsd >= 9);
  assert.match(audit.headline, /Ghost/);
});

test("drill finishes with race guard", async () => {
  const report = await runDrill();
  const race = report.scenarios.find((s) => s.label === "parallel-ceiling-race");
  const ghost = report.scenarios.find((s) => s.label === "leaked-key-ghost");
  assert.equal(race.pass, true);
  assert.equal(ghost.ghostDetected, true);
});
