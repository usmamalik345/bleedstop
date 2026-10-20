import { test } from "node:test";
import assert from "node:assert/strict";
import { resetAll } from "../src/resetAll.js";
import { decide } from "../src/decision.js";
import { estimateCost } from "../src/rules/engine.js";
import { renderPrometheus } from "../src/metrics.js";
import { createClient } from "../src/sdk/client.js";

test("token-aware cost: big estimatedTokens costs more than flat catalog price", () => {
  assert.equal(estimateCost("llm.call", undefined), 0.015);
  assert.ok(estimateCost("llm.call", 20000) > 0.015);
  assert.equal(estimateCost("sms.send", 99999), 0.08);
});

test("unpaid request above token cap is denied (token flooding)", async () => {
  await resetAll();
  const r = await decide({ actorId: "flood", action: "llm.call", paid: false, estimatedTokens: 100000 });
  assert.equal(r.decision, "DENY");
  assert.ok(r.matchedRules.some((m) => m.ruleId === "R-llm-max-tokens"));
});

test("paid request is not subject to the unpaid token cap", async () => {
  await resetAll();
  const r = await decide({ actorId: "payer", action: "llm.call", paid: true, estimatedTokens: 40000 });
  assert.notEqual(r.decision, "DENY");
});

test("LLM velocity rule denies a retry storm inside 60s", async () => {
  await resetAll();
  let denied = null;
  for (let i = 0; i < 70; i++) {
    const r = await decide({ actorId: "loop", action: "llm.call.small", paid: false, signals: { deviceFingerprint: "fp-loop" } });
    if (r.decision === "DENY") { denied = { i, r }; break; }
  }
  assert.ok(denied, "expected a DENY");
  assert.ok(denied.r.matchedRules.some((m) => m.ruleId === "R-llm-velocity"));
  assert.equal(denied.i, 60);
});

test("/metrics exposes latency histogram and denied USD", async () => {
  await resetAll();
  await decide({ actorId: "flood2", action: "llm.call", paid: false, estimatedTokens: 100000 });
  const text = renderPrometheus();
  assert.match(text, /bleedstop_decide_latency_ms_bucket\{le="\+Inf"\} 1/);
  assert.match(text, /bleedstop_denied_usd_total 1(\.\d+)?/);
});

test("SDK guarded does not re-run a call whose idempotencyKey already executed", async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (_url, opts) => {
    calls.push(JSON.parse(opts.body));
    return { ok: true, json: async () => ({ decision: "ALLOW", replay: calls.length > 1 }) };
  };
  try {
    const bs = createClient({ baseUrl: "http://x" });
    let runs = 0;
    const fn = async () => ++runs;
    const a = await bs.guarded({ actorId: "u", action: "llm.call", idempotencyKey: "k1" }, fn);
    const b = await bs.guarded({ actorId: "u", action: "llm.call", idempotencyKey: "k1" }, fn);
    assert.equal(runs, 1);
    assert.equal(a.result, 1);
    assert.equal(b.result, 1);
    assert.equal(b.replay, true);
    // second call never reached /decide
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("SDK guarded treats CHALLENGE as not-ok (no spend)", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ decision: "CHALLENGE" }) });
  try {
    const bs = createClient({ baseUrl: "http://x" });
    let runs = 0;
    const g = await bs.guarded({ actorId: "u", action: "signup.create" }, async () => ++runs);
    assert.equal(g.ok, false);
    assert.equal(runs, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});
