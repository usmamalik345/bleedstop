/**
 * Second stage injection check: the regex agent guard runs first (deterministic, microseconds);
 * if it did not already block and CLASSIFIER_URL is set, the trained classifier sidecar
 * (classifier/server.py) is asked with a hard timeout. Timeouts and errors fail open to the regex
 * verdict and are reported in `stages`, so the classifier can never take the hot path down.
 */
import { precheckAgentCall } from "./agentGuard.js";
import { inc, observe } from "./extraMetrics.js";

export const classifierEnabled = () => Boolean(process.env.CLASSIFIER_URL);

export async function classify(text, { timeoutMs = Number(process.env.CLASSIFIER_TIMEOUT_MS || 300) } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = performance.now();
  try {
    const r = await fetch(`${process.env.CLASSIFIER_URL.replace(/\/$/, "")}/classify`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: String(text).slice(0, 20000) }), signal: ctrl.signal });
    if (!r.ok) throw new Error(`classifier HTTP ${r.status}`);
    const j = await r.json();
    observe("bleedstop_classifier_latency_ms", "Classifier round trip (ms)", performance.now() - t0, {}, [5, 10, 25, 50, 100, 250, 500, 1000]);
    return { ok: true, score: j.score, label: j.label, ms: performance.now() - t0, model: j.model };
  } catch (err) {
    inc("bleedstop_classifier_errors_total", "Classifier timeouts or errors (failed open)", { kind: err.name === "AbortError" ? "timeout" : "error" });
    return { ok: false, error: err.name === "AbortError" ? "timeout" : err.message, ms: performance.now() - t0 };
  } finally { clearTimeout(t); }
}

/** Regex first, classifier second. Returns the agent guard shape plus `stages`. */
export async function precheckTwoStage(input, policy, { threshold = Number(process.env.CLASSIFIER_THRESHOLD || 0.5) } = {}) {
  const r = precheckAgentCall(input, policy);
  const stages = { regex: { verdict: r.verdict, reasons: r.reasons } };
  if (r.verdict === "block" || !classifierEnabled()) return { ...r, stages, firedStage: r.verdict === "block" ? "regex" : null };
  const text = [input.text, input.toolArgs == null ? "" : JSON.stringify(input.toolArgs)].filter(Boolean).join("\n");
  if (!text.trim()) return { ...r, stages, firedStage: null };
  const c = await classify(text);
  stages.classifier = c;
  if (c.ok && c.score >= threshold) {
    return { verdict: "block", score: Math.round((r.score + 0.6) * 100) / 100, reasons: [...r.reasons, `classifier:deberta-v3-v2:${c.score.toFixed(3)}`], stages, firedStage: "classifier" };
  }
  return { ...r, stages, firedStage: r.verdict === "flag" ? "regex" : null };
}
