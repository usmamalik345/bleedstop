/**
 * What the app should do if BleedStop itself is down.
 * PDF: login stays up, paid SMS stops, LLM falls back to a tiny local cap.
 */

export const FAIL_POLICY = {
  "auth.login": "open",
  "signup.create": "open",
  "sms.send": "closed",
  "llm.call": "local_cap",
  "llm.call.small": "local_cap",
  "email.send": "closed",
  "payment.attempt": "closed",
};

export function failPolicyFor(action) {
  return FAIL_POLICY[action] || "closed";
}

/**
 * Used by the SDK when /decide cannot be reached.
 * @returns {{ decision: string, reason: string, degraded: boolean, limit?: object }}
 */
export function fallbackDecision(action) {
  const policy = failPolicyFor(action);
  if (policy === "open") {
    return {
      decision: "ALLOW",
      degraded: true,
      failPolicy: policy,
      reason: "BleedStop down — this action fails open (login/signup).",
    };
  }
  if (policy === "local_cap") {
    return {
      decision: "LIMIT",
      degraded: true,
      failPolicy: policy,
      action: "llm.call.small",
      limit: { action: "llm.call.small", maxTokens: 200 },
      reason: "BleedStop down — local cheap-LLM cap.",
    };
  }
  return {
    decision: "DENY",
    degraded: true,
    failPolicy: policy,
    reason: "BleedStop down — this paid action fails closed.",
  };
}
