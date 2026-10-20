/**
 * Second stage injection check: the regex agent guard runs first (deterministic, microseconds);
 * if it did not already block and a classifier URL is set, the sidecar is asked with a hard timeout.
 * BLEEDSTOP_CLASSIFIER_URL is the new name. CLASSIFIER_URL still works so older deploys keep the same path.
 * Timeouts and errors are counted. Fail open (the default) keeps the regex verdict. Fail closed blocks.
 */
import { precheckAgentCall } from "./agentGuard.js";
import { inc, observe } from "./extraMetrics.js";

/** URL of the classifier HTTP service, with no trailing slash. Empty when neither env var is set. */
export function classifierUrl() {
  return String(process.env.BLEEDSTOP_CLASSIFIER_URL || process.env.CLASSIFIER_URL || "").replace(/\/$/, "");
}

export const classifierEnabled = () => Boolean(classifierUrl());

/** How long to wait for the classifier. New env wins, then the older name, then 800 ms. */
export function classifierTimeoutMs() {
  const n = Number(process.env.BLEEDSTOP_CLASSIFIER_TIMEOUT_MS || process.env.CLASSIFIER_TIMEOUT_MS || 800);
  return Number.isFinite(n) && n > 0 ? n : 800;
}

/**
 * open: a dead or slow classifier does not block the user (regex still decides in "both" mode).
 * closed: a dead or slow classifier is treated as a block, so an outage stops calls that need it.
 */
export function classifierFailMode() {
  return String(process.env.BLEEDSTOP_CLASSIFIER_FAILMODE || "open").trim().toLowerCase() === "closed" ? "closed" : "open";
}

export async function classify(text, { timeoutMs = classifierTimeoutMs() } = {}) {
  const url = classifierUrl();
  const t0 = performance.now();
  if (!url) return { ok: false, error: "no_url", ms: 0 };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${url}/classify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: String(text).slice(0, 20000) }), signal: ctrl.signal });
    if (!r.ok) throw new Error(`classifier HTTP ${r.status}`);
    const j = await r.json();
    observe("bleedstop_classifier_latency_ms", "Classifier round trip (ms)", performance.now() - t0, {}, [5, 10, 25, 50, 100, 250, 500, 1000]);
    return { ok: true, score: j.score, label: j.label, ms: performance.now() - t0, model: j.model };
  } catch (err) {
    const kind = err.name === "AbortError" ? "timeout" : "error";
    const failMode = classifierFailMode();
    inc("bleedstop_classifier_errors_total", "Classifier timeouts or errors", { kind, failmode: failMode });
    // The prompt is not logged. A warning plus the metric is enough to see an outage.
    console.warn(JSON.stringify({ level: "warn", msg: "classifier_unavailable", kind, failMode }));
    return { ok: false, error: kind === "timeout" ? "timeout" : err.message, ms: performance.now() - t0 };
  } finally { clearTimeout(t); }
}

/** Regex first, classifier second. Returns the agent guard shape plus `stages`. */
export async function precheckTwoStage(input, policy, { threshold = Number(process.env.BLEEDSTOP_CLASSIFIER_THRESHOLD || process.env.CLASSIFIER_THRESHOLD || 0.5) } = {}) {
  const r = precheckAgentCall(input, policy);
  const stages = { regex: { verdict: r.verdict, reasons: r.reasons } };
  if (r.verdict === "block" || !classifierEnabled()) return { ...r, stages, firedStage: r.verdict === "block" ? "regex" : null };
  const text = [input.text, input.toolArgs == null ? "" : JSON.stringify(input.toolArgs)].filter(Boolean).join("\n");
  if (!text.trim()) return { ...r, stages, firedStage: null };
  const c = await classify(text);
  stages.classifier = c;
  if (!c.ok && classifierFailMode() === "closed") {
    return { verdict: "block", score: 1, reasons: [...r.reasons, "classifier_unavailable"], stages, firedStage: "classifier", failMode: "closed" };
  }
  if (c.ok && c.score >= threshold) {
    return { verdict: "block", score: Math.round((r.score + 0.6) * 100) / 100, reasons: [...r.reasons, `classifier:deberta-v3-v2:${c.score.toFixed(3)}`], stages, firedStage: "classifier" };
  }
  return { ...r, stages, firedStage: r.verdict === "flag" ? "regex" : null, failMode: c.ok ? undefined : "open" };
}
