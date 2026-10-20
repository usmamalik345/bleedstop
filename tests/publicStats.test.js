import { test } from "node:test";
import assert from "node:assert/strict";
import { incDecide, publicWindow, resetMetrics } from "../src/metrics.js";
import { otlpHeaders } from "../src/tracing.js";

test("public window counts this process and reports p50", () => {
  resetMetrics();
  incDecide("ALLOW", { latencyMs: 4 });
  incDecide("ALLOW", { latencyMs: 10 });
  incDecide("DENY", { latencyMs: 2 });
  const w = publicWindow();
  assert.equal(w.n, 3);
  assert.equal(w.decisions.ALLOW, 2);
  assert.equal(w.decisions.DENY, 1);
  assert.equal(w.decisions.LIMIT, 0);
  assert.equal(w.p50LatencyMs, 4);
  resetMetrics();
});

test("otlp header parser keeps values out of the key list only", () => {
  const h = otlpHeaders("Authorization=Basic abc,  X-Scope-OrgID=1");
  assert.equal(h.Authorization, "Basic abc");
  assert.equal(h["X-Scope-OrgID"], "1");
  assert.deepEqual(otlpHeaders(""), {});
});
