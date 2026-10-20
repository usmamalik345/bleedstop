/**
 * Rule store = the list of money/abuse rules.
 * Modes: shadow (log only) → enforce (really block/limit).
 */

import { recordAudit } from "../auditLog.js";
import { incRuleModeChange } from "../metrics.js";

/** @type {object[]} */
const rules = [
  {
    id: "R-ceiling",
    name: "unpaid-cluster-ceiling",
    enabled: true,
    mode: "enforce",
    type: "unpaid_ceiling",
    description: "Unpaid cluster may cost at most $UNPAID_CEILING across all vendors.",
  },
  {
    id: "R-paid-ceiling",
    name: "paid-cluster-ceiling",
    enabled: true,
    mode: "enforce",
    type: "paid_ceiling",
    description: "Paid cluster may cost at most $PAID_CEILING (higher than free users).",
  },
  {
    id: "R-sms-velocity",
    name: "sms-velocity",
    enabled: true,
    mode: "enforce",
    type: "sms_velocity",
    description: "Too many SMS from one cluster in a short window → DENY.",
  },
  {
    id: "R-otp-country",
    name: "otp-country-mismatch",
    enabled: true,
    mode: "shadow",
    type: "otp_country_mismatch",
    description:
      "Block OTP when phone country differs from IP country for new unpaid accounts.",
  },
  {
    id: "R-signup-challenge",
    name: "signup-honeypot-challenge",
    enabled: true,
    mode: "enforce",
    type: "signup_challenge",
    description:
      "Unpaid signup with a disposable email or a filled honeypot → CHALLENGE (no spend yet).",
  },
  {
    id: "R-llm-max-tokens",
    name: "llm-max-tokens-per-request",
    enabled: true,
    mode: "enforce",
    type: "llm_max_tokens",
    description: "Unpaid LLM request with estimatedTokens above LLM_MAX_TOKENS_UNPAID → DENY (token flooding).",
  },
  {
    id: "R-llm-velocity",
    name: "llm-velocity",
    enabled: true,
    mode: "enforce",
    type: "llm_velocity",
    description: "Unpaid cluster above LLM_VELOCITY_MAX_PER_MIN calls in 60s → DENY (retry/loop storms).",
  },
  {
    id: "R-subnet-pool",
    name: "subnet-pool-ceiling",
    enabled: true,
    mode: "enforce",
    type: "subnet_pool_ceiling",
    description: "Once a /24 (IPv6 /64) has >= subnetPoolMinActors unpaid actors, they share one pool ceiling (rotating farms). Never unions identities.",
  },
  {
    id: "R-asn-spread",
    name: "asn-spread",
    enabled: true,
    mode: "enforce",
    type: "asn_spread",
    description: "Unpaid actors from one ASN across > asnSpreadMaxSubnets /24s → CHALLENGE. Policy asnSpreadMode (default shadow).",
  },
  {
    id: "R-agent-guard",
    name: "agent-guard",
    enabled: true,
    mode: "enforce",
    type: "agent_guard",
    description: "Prompt injection / exfiltration / tool loop / recursion pre-check for agent calls (body.agent).",
  },
  {
    id: "R-llm-limit",
    name: "llm-soft-limit-near-ceiling",
    enabled: true,
    mode: "enforce",
    type: "llm_soft_limit",
    description:
      "Near unpaid ceiling, allow only small/cheap LLM calls (LIMIT).",
  },
];

/** @type {object[]} */
const proposals = [];

export function listRules() {
  return rules.map((r) => ({ ...r }));
}

export function getRule(id) {
  return rules.find((r) => r.id === id) ?? null;
}

export function setRuleMode(id, mode, { actor = "operator" } = {}) {
  const rule = rules.find((r) => r.id === id);
  if (!rule) throw new Error(`Unknown rule ${id}`);
  if (!["shadow", "enforce"].includes(mode)) {
    throw new Error(`mode must be shadow or enforce`);
  }
  const before = rule.mode;
  rule.mode = mode;
  recordAudit({
    action: "rule.mode_change",
    actor,
    target: id,
    before,
    after: mode,
    meta: { name: rule.name },
  });
  incRuleModeChange();
  return { ...rule };
}

export function addProposal(proposal) {
  const row = {
    id: `P-${proposals.length + 1}`,
    at: new Date().toISOString(),
    status: "pending",
    ...proposal,
  };
  proposals.unshift(row);
  return row;
}

export function listProposals() {
  return [...proposals];
}

export function approveProposal(id) {
  const p = proposals.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown proposal ${id}`);
  p.status = "approved";
  if (p.rule && !rules.find((r) => r.id === p.rule.id)) {
    rules.push({ ...p.rule, mode: "shadow", enabled: true });
  } else if (p.rule?.id) {
    setRuleMode(p.rule.id, "shadow");
  }
  return p;
}

export function resetProposals() {
  proposals.length = 0;
}
