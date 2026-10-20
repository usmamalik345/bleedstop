/**
 * Which injection check the server runs.
 *
 * BLEEDSTOP_DETECTOR:
 *   regex       phrase list only (the default)
 *   classifier  HTTP sidecar only (BLEEDSTOP_CLASSIFIER_URL or CLASSIFIER_URL)
 *   both        phrase list first; the sidecar sees only what the list allowed
 *
 * If the flag is unset and the older CLASSIFIER_URL is set, mode is "both"
 * so existing deploys keep the same behaviour. The new URL alone does not
 * turn the sidecar on. Set the flag.
 *
 * Fail mode (BLEEDSTOP_CLASSIFIER_FAILMODE, default open):
 *   open   the sidecar is down or slower than the timeout (default 800 ms):
 *          "both" keeps the phrase-list verdict; "classifier" allows the call.
 *          A warning is logged and bleedstop_classifier_errors_total increments.
 *          Tradeoff: an outage does not stop users, but a classifier-only
 *          deploy then misses injections until the sidecar is back.
 *   closed the same outage becomes a block.
 *          Tradeoff: injections are not waved through, but a dead sidecar
 *          stops every call that needed it.
 */
import { precheckAgentCall } from "./agentGuard.js";
import { classify, classifierFailMode, precheckTwoStage } from "./classifierClient.js";
import { prepareAgentInput } from "./textNorm.js";

export function detectorMode() {
  const m = String(process.env.BLEEDSTOP_DETECTOR || "").trim().toLowerCase();
  if (m === "regex" || m === "classifier" || m === "both") return m;
  if (process.env.CLASSIFIER_URL) return "both";
  return "regex";
}

function agentText(input) {
  return [input?.text, input?.toolArgs == null ? "" : JSON.stringify(input.toolArgs)].filter(Boolean).join("\n");
}

async function classifierOnly(input) {
  const text = agentText(input);
  const c = await classify(text);
  const threshold = Number(process.env.BLEEDSTOP_CLASSIFIER_THRESHOLD || process.env.CLASSIFIER_THRESHOLD || 0.5);
  if (!c.ok) {
    if (classifierFailMode() === "closed") {
      return { verdict: "block", score: 1, reasons: ["classifier_unavailable"], stages: { classifier: c }, firedStage: "classifier", detector: "classifier", failMode: "closed" };
    }
    return { verdict: "allow", score: 0, reasons: ["classifier_unavailable_fail_open"], stages: { classifier: c }, firedStage: null, detector: "classifier", failMode: "open" };
  }
  const score = Number(c.score);
  const block = Number.isFinite(score) && score >= threshold;
  return {
    verdict: block ? "block" : "allow",
    score: block ? score : 0,
    reasons: block ? [`classifier:${score.toFixed(3)}`] : [],
    stages: { classifier: c },
    firedStage: block ? "classifier" : null,
    detector: "classifier",
  };
}

/** Run the detector selected by BLEEDSTOP_DETECTOR. Extra fields do not change the verdict words. */
export async function detect(input, policy) {
  const ready = prepareAgentInput(input);
  const mode = detectorMode();
  if (mode === "regex") {
    return { ...precheckAgentCall(ready, policy), detector: "regex" };
  }
  if (mode === "classifier") return classifierOnly(ready);
  const r = await precheckTwoStage(ready, policy);
  return { ...r, detector: r.firedStage || "regex" };
}
