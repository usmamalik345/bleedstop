/**
 * Lightweight Prometheus-style metrics (no extra dependency).
 * Scrape: GET /metrics
 */

const counters = {
  decide_allow: 0,
  decide_limit: 0,
  decide_deny: 0,
  decide_challenge: 0,
  decide_replay: 0,
  reconcile_runs: 0,
  reconcile_ghosts: 0,
  rule_mode_changes: 0,
  redis_spend_syncs: 0,
  degraded_redis: 0,
};

/** Prometheus histogram buckets (ms) for /decide latency */
const BUCKETS_MS = [0.5, 1, 2, 5, 10, 25, 50, 100, 250];
const bucketCounts = new Array(BUCKETS_MS.length).fill(0);
let deniedUsdTotal = 0;

let decideLatencyMsSum = 0;
let decideLatencyMsCount = 0;
/** Last hour of decisions in this process. The demo panel reads this. */
const recent = [];
const HOUR_MS = 60 * 60 * 1000;
const MAX_RECENT = 20000;

export function incDecide(decision, { replay = false, latencyMs = 0, deniedUsd = 0 } = {}) {
  if (deniedUsd > 0) deniedUsdTotal += deniedUsd;
  for (let i = 0; i < BUCKETS_MS.length; i++) if (latencyMs <= BUCKETS_MS[i]) bucketCounts[i] += 1;
  if (replay) counters.decide_replay += 1;
  const key = `decide_${String(decision || "allow").toLowerCase()}`;
  if (counters[key] !== undefined) counters[key] += 1;
  // Count every decision (Date.now() resolution often gives 0 ms)
  decideLatencyMsSum += latencyMs;
  decideLatencyMsCount += 1;
  recent.push({ t: Date.now(), decision: String(decision || "").toUpperCase(), ms: Number(latencyMs) || 0 });
  const cut = Date.now() - HOUR_MS;
  while (recent.length && (recent[0].t < cut || recent.length > MAX_RECENT)) recent.shift();
}

export function incReconcile({ ghosts = 0 } = {}) {
  counters.reconcile_runs += 1;
  counters.reconcile_ghosts += ghosts;
}

export function incRuleModeChange() {
  counters.rule_mode_changes += 1;
}

export function incDegraded() {
  counters.degraded_redis += 1;
}

export function incRedisSpendSync() {
  counters.redis_spend_syncs += 1;
}

export function snapshot() {
  return {
    ...counters,
    decide_latency_ms_avg:
      decideLatencyMsCount === 0
        ? 0
        : Math.round((decideLatencyMsSum / decideLatencyMsCount) * 1000) / 1000,
  };
}

import { renderExtra } from "./extraMetrics.js";

/** Prometheus text exposition format */
export function renderPrometheus() {
  const s = snapshot();
  const lines = [
    "# HELP bleedstop_decide_total Decisions by outcome",
    "# TYPE bleedstop_decide_total counter",
    `bleedstop_decide_total{decision="ALLOW"} ${s.decide_allow}`,
    `bleedstop_decide_total{decision="LIMIT"} ${s.decide_limit}`,
    `bleedstop_decide_total{decision="DENY"} ${s.decide_deny}`,
    `bleedstop_decide_total{decision="CHALLENGE"} ${s.decide_challenge}`,
    `bleedstop_decide_total{decision="REPLAY"} ${s.decide_replay}`,
    "# HELP bleedstop_reconcile_runs_total Reconcile worker/API runs",
    "# TYPE bleedstop_reconcile_runs_total counter",
    `bleedstop_reconcile_runs_total ${s.reconcile_runs}`,
    "# HELP bleedstop_reconcile_ghosts_total Ghost detections observed",
    "# TYPE bleedstop_reconcile_ghosts_total counter",
    `bleedstop_reconcile_ghosts_total ${s.reconcile_ghosts}`,
    "# HELP bleedstop_rule_mode_changes_total Shadow/enforce toggles",
    "# TYPE bleedstop_rule_mode_changes_total counter",
    `bleedstop_rule_mode_changes_total ${s.rule_mode_changes}`,
    "# HELP bleedstop_redis_spend_syncs_total Redis spend counter updates",
    "# TYPE bleedstop_redis_spend_syncs_total counter",
    `bleedstop_redis_spend_syncs_total ${s.redis_spend_syncs}`,
    "# HELP bleedstop_decide_latency_ms_avg Average decide latency",
    "# TYPE bleedstop_decide_latency_ms_avg gauge",
    `bleedstop_decide_latency_ms_avg ${s.decide_latency_ms_avg}`,
    "# HELP bleedstop_degraded_redis_total Redis errors that switched this process to local mode",
    "# TYPE bleedstop_degraded_redis_total counter",
    `bleedstop_degraded_redis_total ${s.degraded_redis}`,
    "# HELP bleedstop_decide_latency_ms /decide latency histogram (ms)",
    "# TYPE bleedstop_decide_latency_ms histogram",
    ...BUCKETS_MS.map((b, i) => `bleedstop_decide_latency_ms_bucket{le="${b}"} ${bucketCounts[i]}`),
    `bleedstop_decide_latency_ms_bucket{le="+Inf"} ${decideLatencyMsCount}`,
    `bleedstop_decide_latency_ms_sum ${decideLatencyMsSum}`,
    `bleedstop_decide_latency_ms_count ${decideLatencyMsCount}`,
    "# HELP bleedstop_denied_usd_total Estimated USD of requests denied by rules",
    "# TYPE bleedstop_denied_usd_total counter",
    `bleedstop_denied_usd_total ${Math.round(deniedUsdTotal * 1e6) / 1e6}`,
  ];
  return lines.join("\n") + "\n" + renderExtra();
}

export function resetMetrics() {
  for (const k of Object.keys(counters)) counters[k] = 0;
  decideLatencyMsSum = 0;
  decideLatencyMsCount = 0;
  bucketCounts.fill(0);
  deniedUsdTotal = 0;
  recent.length = 0;
}

/** Decisions this process handled in the last hour. Not a global total. */
export function publicWindow() {
  const cut = Date.now() - HOUR_MS;
  const rows = recent.filter((r) => r.t >= cut);
  const decisions = { ALLOW: 0, LIMIT: 0, DENY: 0, CHALLENGE: 0 };
  const lats = [];
  for (const r of rows) {
    if (decisions[r.decision] != null) decisions[r.decision] += 1;
    lats.push(r.ms);
  }
  lats.sort((a, b) => a - b);
  const p50 = lats.length ? lats[Math.min(lats.length - 1, Math.max(0, Math.ceil(0.5 * lats.length) - 1))] : null;
  return {
    window: "1h",
    n: rows.length,
    decisions,
    p50LatencyMs: p50 == null ? null : Math.round(p50 * 1000) / 1000,
    instance: String(process.pid),
  };
}
