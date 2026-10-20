/**
 * Deterministic rule engine — the only thing that can ALLOW/LIMIT/DENY.
 * Agents may propose rules; they never decide live traffic.
 */

import { config } from "../config.js";
import { getPrice } from "../priceCatalog.js";
import { getSpend, getSpendCeilingUsd } from "../ledger.js";
import { listEvents } from "../eventLog.js";
import { listRules } from "./store.js";
import { getPolicy } from "../policy.js";
import { getPoolSpend } from "../network.js";

/** Token-aware cost for LLM actions when the caller sends estimatedTokens. */
export function estimateCost(action, estimatedTokens) {
  const flat = getPrice(action);
  const t = Number(estimatedTokens);
  if (action === "llm.call" && Number.isFinite(t) && t > 0) {
    return Math.max(flat, (t / 1000) * getPolicy().llmUsdPer1kTokens);
  }
  return flat;
}

/**
 * @returns {{
 *   decision: "ALLOW" | "LIMIT" | "CHALLENGE" | "DENY",
 *   matchedRules: object[],
 *   shadowHits: object[],
 *   action: string,
 *   estimatedCost: number,
 *   limit?: object,
 *   ceilingUsd?: number
 * }}
 */
export function evaluateRules(ctx) {
  const {
    action,
    paid = false,
    clusterId,
    phoneCountry,
    ipCountry,
  } = ctx;

  let estimatedCost = estimateCost(action, ctx.estimatedTokens);
  let decision = "ALLOW";
  let finalAction = action;
  const matchedRules = [];
  const shadowHits = [];
  let limit = null;
  const ceilingUsd = paid ? getPolicy().paidCeilingUsd : getPolicy().unpaidCeilingUsd;

  const rules = listRules().filter((r) => r.enabled);

  for (const rule of rules) {
    const hit = matchRule(rule, {
      ...ctx,
      estimatedCost,
      spendBefore: getSpend(clusterId),
      ceilingUsd,
    });
    if (!hit) continue;

    // Policy can force a rule into shadow per tenant (e.g. asnSpreadMode: shadow)
    if (rule.mode === "shadow" || hit.modeOverride === "shadow") {
      shadowHits.push({ ruleId: rule.id, would: hit.decision, reason: hit.reason });
      continue;
    }

    matchedRules.push({ ruleId: rule.id, decision: hit.decision, reason: hit.reason });

    // Precedence: DENY > CHALLENGE > LIMIT > ALLOW
    if (hit.decision === "DENY") {
      decision = "DENY";
      break;
    }
    if (hit.decision === "CHALLENGE" && decision !== "DENY") {
      decision = "CHALLENGE";
      continue;
    }
    if (hit.decision === "LIMIT" && decision === "ALLOW") {
      decision = "LIMIT";
      finalAction = hit.action ?? "llm.call.small";
      estimatedCost = getPrice(finalAction);
      limit = hit.limit ?? {
        action: finalAction,
        maxTokens: 300,
        note: "Cheaper model / smaller prompt",
      };
    }
  }

  // Safety net if ceiling rules disabled
  if (decision !== "DENY") {
    const spendBefore = getSpend(clusterId);
    if (spendBefore + estimatedCost > ceilingUsd) {
      const label = paid ? "paid" : "unpaid";
      decision = "DENY";
      matchedRules.push({
        ruleId: paid ? "R-paid-ceiling" : "R-ceiling",
        decision: "DENY",
        reason: `Would exceed ${label} ceiling $${ceilingUsd}`,
      });
    }
  }

  void phoneCountry;
  void ipCountry;

  return {
    decision,
    matchedRules,
    shadowHits,
    action: finalAction,
    estimatedCost,
    limit,
    ceilingUsd,
  };
}

function matchRule(rule, ctx) {
  const { type } = rule;
  const {
    action,
    paid,
    estimatedCost,
    spendBefore,
    clusterId,
    phoneCountry,
    ipCountry,
    ceilingUsd,
  } = ctx;

  if (type === "unpaid_ceiling" && !paid) {
    if (spendBefore + estimatedCost > ceilingUsd) {
      return {
        decision: "DENY",
        reason: `Unpaid cluster would exceed $${ceilingUsd} (now $${spendBefore}, +$${estimatedCost})`,
      };
    }
  }

  if (type === "paid_ceiling" && paid) {
    if (spendBefore + estimatedCost > ceilingUsd) {
      return {
        decision: "DENY",
        reason: `Paid cluster would exceed $${ceilingUsd} (now $${spendBefore}, +$${estimatedCost})`,
      };
    }
  }

  if (type === "sms_velocity" && action === "sms.send" && !paid) {
    const recent = listEvents({ limit: 500 }).filter(
      (e) =>
        e.clusterId === clusterId &&
        e.action === "sms.send" &&
        (e.decision === "ALLOW" || e.decision === "LIMIT") &&
        Date.now() - new Date(e.at).getTime() < 10 * 60 * 1000
    );
    if (recent.length >= config.smsVelocityMax) {
      return {
        decision: "DENY",
        reason: `SMS velocity ${recent.length} in 10m ≥ ${config.smsVelocityMax}`,
      };
    }
  }

  if (
    type === "otp_country_mismatch" &&
    action === "sms.send" &&
    !paid &&
    phoneCountry &&
    ipCountry &&
    phoneCountry !== ipCountry
  ) {
    return {
      decision: "DENY",
      reason: `OTP country ${phoneCountry} ≠ IP country ${ipCountry}`,
    };
  }

  if (type === "signup_challenge" && action === "signup.create" && !paid) {
    const email = String(ctx.signals?.email || "");
    const honeypot = Boolean(ctx.signals?.honeypot);
    const disposable = /mailinator|guerrillamail|tempmail/i.test(email);
    if (honeypot || disposable) {
      return {
        decision: "CHALLENGE",
        reason: honeypot
          ? "Honeypot field was filled — ask for a challenge before spending."
          : `Disposable email ${email} — challenge before OTP/LLM spend.`,
      };
    }
  }

  const policy = getPolicy();

  if (type === "llm_max_tokens" && action.startsWith("llm") && !paid) {
    const t = Number(ctx.estimatedTokens);
    if (Number.isFinite(t) && t > policy.llmMaxTokensUnpaid) {
      return {
        decision: "DENY",
        reason: `Estimated ${t} tokens > unpaid per-request cap ${policy.llmMaxTokensUnpaid}`,
      };
    }
  }

  if (type === "llm_velocity" && action.startsWith("llm") && !paid) {
    const n = Number(ctx.llmVelocity || 0);
    if (n >= policy.llmVelocityMaxPerMin) {
      return {
        decision: "DENY",
        reason: `LLM velocity ${n} calls/60s >= ${policy.llmVelocityMaxPerMin} for ${clusterId}`,
      };
    }
  }

  const nw = ctx.network;
  if (type === "subnet_pool_ceiling" && !paid && nw?.subnet && !nw.allowlisted && estimatedCost > 0) {
    if (nw.subnetActors >= policy.subnetPoolMinActors) {
      const pool = nw.poolSpendUsd ?? getPoolSpend(nw.subnet);
      // Pool grows with distinct actors (big offices/campus NAT), floor = subnetPoolCeilingUsd
      const poolCeiling = Math.max(policy.subnetPoolCeilingUsd, policy.subnetPoolPerActorUsd * nw.subnetActors);
      if (pool + estimatedCost > poolCeiling) {
        return {
          decision: "DENY",
          reason: `Subnet ${nw.subnet} pool (${nw.subnetActors} unpaid actors) would exceed $${poolCeiling.toFixed(2)} (now $${pool.toFixed(3)})`,
        };
      }
    }
  }

  if (type === "asn_spread" && !paid && nw?.asn && !nw.allowlisted && policy.asnSpreadMode !== "off") {
    if (nw.asnSubnets > policy.asnSpreadMaxSubnets) {
      return {
        decision: "CHALLENGE",
        modeOverride: policy.asnSpreadMode,
        reason: `ASN ${nw.asn}: unpaid actors from ${nw.asnSubnets} distinct /24s in window > ${policy.asnSpreadMaxSubnets}`,
      };
    }
  }

  if (type === "agent_guard" && ctx.agentCheck && policy.agentGuardMode !== "off") {
    const g = ctx.agentCheck;
    if (g.verdict === "block") {
      return { decision: "DENY", modeOverride: policy.agentGuardMode, reason: `Agent guard: ${g.reasons.join(", ")}` };
    }
  }

  if (type === "llm_soft_limit" && action === "llm.call" && !paid) {
    const headroom = ceilingUsd - spendBefore;
    if (headroom > 0 && headroom < estimatedCost * 3) {
      return {
        decision: "LIMIT",
        action: "llm.call.small",
        reason: "Near unpaid ceiling — downgrade to small LLM call",
        limit: { action: "llm.call.small", maxTokens: 300 },
      };
    }
  }

  return null;
}
