/**
 * Decision API brain:
 * 1) cluster identity
 * 2) deterministic rules → ALLOW | LIMIT | DENY
 * 3) optional reserve/commit + idempotency
 * 4) write key ledger + mock vendor usage on success
 * 5) Redis sync when enabled (multi-pod ceilings)
 */

import { resolveCluster } from "./cluster.js";
import { evaluateRules } from "./rules/engine.js";
import {
  addSpend,
  getSpend,
  reserve,
  commit,
  getSpendCeilingUsd,
  syncSpendFromRedis,
} from "./ledger.js";
import { addAppKeySpend } from "./keyLedger.js";
import { getKeyStatus, recordVendorUsage } from "./vendorMock.js";
import { appendEvent } from "./eventLog.js";
import { recordIncident } from "./incidents.js";
import { getIdempotentResult, setIdempotentResult } from "./idempotency.js";
import { incDecide } from "./metrics.js";
import { withClusterLock } from "./locks.js";
import { isOtpFrozen } from "./runbooks.js";
import { enqueue } from "./queue/memoryQueue.js";
import { randomUUID } from "crypto";
import { recordCall, countRecent } from "./velocity.js";
import { toSignalKeys } from "./cluster.js";
import { redisEnabled, disableRedis } from "./db/redis.js";
import { incDegraded } from "./metrics.js";

/** Graceful degradation: a Redis error switches this process to local mode, never 5xx. */
async function shared(fn, fallback) {
  try {
    return await fn();
  } catch (err) {
    disableRedis(err.message);
    incDegraded();
    return fallback();
  }
}
import { resolveClusterShared, atomicCharge, velocityIncr, velocityPeek, sharedSpend, observeNetworkShared, addPoolSpendShared } from "./db/redisShared.js";
import { setLocalSpend } from "./ledger.js";
import { observeNetwork, addPoolSpend, WINDOW_MS as NETWORK_WINDOW_MS } from "./network.js";
import { precheckAgentCall } from "./agentGuard.js";
import { detect } from "./detectors.js";
import { getPolicy } from "./policy.js";
import { withSpan } from "./tracing.js";
import { atomicPgSpend, pgBudgetEnabled } from "./db/pgBudget.js";
import { recordAudit } from "./auditLog.js";
import { getTenantId } from "./tenant/context.js";

/** Atomic Lua ceiling in Redis mode (REDIS_ATOMIC=0 reproduces the legacy race for benchmarks). */
const atomicMode = () => redisEnabled() && process.env.REDIS_ATOMIC !== "0";

async function decideInner(input) {
  const started = performance.now();
  const {
    actorId,
    action,
    paid = false,
    vendorKeyId,
    signals = {},
    phoneCountry,
    ipCountry,
    idempotencyKey,
    mode = "auto", // auto | reserve | commit
    actualCost,
    estimatedTokens,
  } = input;

  if (!actorId || !action) {
    throw new Error("actorId and action are required");
  }

  // Same key twice → same answer, no double charge (auto path)
  if (mode === "auto" && idempotencyKey) {
    const cached = getIdempotentResult(idempotencyKey);
    if (cached) {
      incDecide(cached.decision, {
        replay: true,
        latencyMs: performance.now() - started,
      });
      return cached;
    }
  }

  const clusterId = await withSpan("bleedstop.cluster.resolve", { "bleedstop.shared": atomicMode() }, async () => atomicMode()
    ? await shared(() => resolveClusterShared(actorId, toSignalKeys(signals)), () => resolveCluster(actorId, signals))
    : resolveCluster(actorId, signals));
  if (atomicMode()) await shared(async () => setLocalSpend(clusterId, await sharedSpend(clusterId)), () => null);
  else await syncSpendFromRedis(clusterId);
  let network = observeNetwork({ actorId, ip: signals.ip, asn: signals.asn, paid });
  if (atomicMode() && network.subnet && !paid) {
    const s = await shared(() => observeNetworkShared({ actorId, subnet: network.subnet, asn: network.asn }, NETWORK_WINDOW_MS), () => null);
    if (s) network = { ...network, ...s };
  }
  const llmVelocity = atomicMode()
    ? await shared(() => velocityPeek(clusterId), () => countRecent(`${clusterId}:llm`))
    : countRecent(`${clusterId}:llm`);
  // Default stays the phrase list. BLEEDSTOP_DETECTOR opts into the sidecar.
  const agentCheck = input.agent
    ? (process.env.BLEEDSTOP_DETECTOR
      ? await detect(input.agent, getPolicy())
      : precheckAgentCall(input.agent, getPolicy()))
    : null;

  if (action === "sms.send" && isOtpFrozen(clusterId)) {
    const denied = denyResult({
      actorId,
      clusterId,
      vendorKeyId,
      action,
      reason: `OTP frozen for ${clusterId} (runbook).`,
      paid,
      phoneCountry,
      ipCountry,
    });
    incDecide("DENY", { latencyMs: performance.now() - started });
    return denied;
  }

  if (vendorKeyId && getKeyStatus(vendorKeyId) === "disabled") {
    const denied = denyResult({
      actorId,
      clusterId,
      vendorKeyId,
      action,
      reason: `Vendor key ${vendorKeyId} is disabled (kill switch).`,
      paid,
      phoneCountry,
      ipCountry,
    });
    incDecide("DENY", { latencyMs: performance.now() - started });
    return denied;
  }

  if (mode === "commit") {
    if (!idempotencyKey) throw new Error("commit requires idempotencyKey");
    const cost = actualCost ?? 0;
    const committed = commit(idempotencyKey, cost);
    if (vendorKeyId && !committed.replay) {
      addAppKeySpend(vendorKeyId, cost);
      recordVendorUsage(vendorKeyId, cost);
    }
    const event = appendEvent({
      type: "spend_commit",
      decision: "ALLOW",
      actorId,
      clusterId,
      action,
      actualCost: cost,
      vendorKeyId: vendorKeyId ?? null,
      paid,
      replay: Boolean(committed.replay),
    });
    const out = {
      decision: "ALLOW",
      clusterId,
      vendorKeyId: vendorKeyId ?? null,
      ...committed,
      eventId: event.id,
      reason: committed.replay
        ? "Reservation commit replay (idempotent)."
        : "Reservation committed.",
    };
    incDecide("ALLOW", {
      replay: Boolean(committed.replay),
      latencyMs: performance.now() - started,
    });
    return out;
  }

  const evaluation = await withSpan("bleedstop.rules.evaluate", {}, async (span) => {
    const ev = evaluateRules({
    actorId,
    action,
    paid,
    clusterId,
    phoneCountry,
    ipCountry,
    signals,
    estimatedTokens,
    network,
    llmVelocity,
    agentCheck,
  });
    span.setAttributes({ "bleedstop.rules.decision": ev.decision, "bleedstop.rules.matched": ev.matchedRules.length, "bleedstop.rules.shadow": ev.shadowHits.length });
    return ev;
  });

  const spendBefore = getSpend(clusterId);

  if (evaluation.decision === "DENY") {
    maybeRecordClusterIncident(clusterId, evaluation, spendBefore);
    const denied = denyResult({
      actorId,
      clusterId,
      vendorKeyId,
      action,
      reason: evaluation.matchedRules[0]?.reason || "Denied by rules",
      paid,
      phoneCountry,
      ipCountry,
      matchedRules: evaluation.matchedRules,
      shadowHits: evaluation.shadowHits,
      estimatedCost: evaluation.estimatedCost,
      spendBefore,
      agentCheck,
    });
    if (mode === "auto" && idempotencyKey) {
      setIdempotentResult(idempotencyKey, denied);
    }
    incDecide("DENY", { latencyMs: performance.now() - started, deniedUsd: evaluation.estimatedCost });
    return denied;
  }

  if (evaluation.decision === "CHALLENGE") {
    const event = appendEvent({
      type: "decision",
      decision: "CHALLENGE",
      actorId,
      clusterId,
      action,
      spendBefore,
      vendorKeyId: vendorKeyId ?? null,
      paid,
      matchedRules: evaluation.matchedRules,
      shadowHits: evaluation.shadowHits,
    });
    const challenged = {
      decision: "CHALLENGE",
      clusterId,
      action,
      estimatedCost: 0,
      spendBefore,
      spendAfter: spendBefore,
      reason: evaluation.matchedRules[0]?.reason || "Challenge required before spend",
      matchedRules: evaluation.matchedRules,
      shadowHits: evaluation.shadowHits,
      eventId: event.id,
      challenge: { type: "captcha_or_email_proof" },
    };
    if (mode === "auto" && idempotencyKey) setIdempotentResult(idempotencyKey, challenged);
    incDecide("CHALLENGE", { latencyMs: performance.now() - started });
    enqueue({ type: "decision", decision: "CHALLENGE", clusterId, actorId });
    return challenged;
  }

  const finalAction = evaluation.action;
  const estimatedCost = evaluation.estimatedCost;
  const key = idempotencyKey || randomUUID();

  if (mode === "reserve") {
    const reserved = reserve(clusterId, estimatedCost, key);
    const event = appendEvent({
      type: "decision",
      decision: evaluation.decision,
      actorId,
      clusterId,
      action: finalAction,
      originalAction: action,
      estimatedCost,
      vendorKeyId: vendorKeyId ?? null,
      paid,
      phoneCountry,
      ipCountry,
      reserved: true,
      idempotencyKey: key,
      replay: Boolean(reserved.replay),
      matchedRules: evaluation.matchedRules,
      shadowHits: evaluation.shadowHits,
    });
    const out = {
      decision: evaluation.decision,
      clusterId,
      vendorKeyId: vendorKeyId ?? null,
      action: finalAction,
      estimatedCost,
      spendBefore,
      spendAfter: getSpend(clusterId),
      idempotencyKey: key,
      replay: Boolean(reserved.replay),
      limit: evaluation.limit,
      matchedRules: evaluation.matchedRules,
      shadowHits: evaluation.shadowHits,
      reason:
        evaluation.decision === "LIMIT"
          ? evaluation.matchedRules.find((m) => m.decision === "LIMIT")?.reason ||
            "Limited"
          : reserved.replay
            ? `Reservation replay for ${key}`
            : `Reserved ${estimatedCost} under ${paid ? "paid" : "unpaid"} ceiling $${evaluation.ceilingUsd}`,
      eventId: event.id,
      ceilingUsd: evaluation.ceilingUsd,
    };
    incDecide(evaluation.decision, {
      replay: Boolean(reserved.replay),
      latencyMs: performance.now() - started,
    });
    return out;
  }

  // auto: re-check the ceiling atomically (Redis Lua across instances) or inside a
  // per-process lock so parallel calls cannot all pass
  const localCharge = () =>
    withClusterLock(clusterId, async () => {
      const live = getSpend(clusterId);
      const ceiling = evaluation.ceilingUsd ?? getSpendCeilingUsd(paid);
      if (live + estimatedCost > ceiling) {
        return { over: true, live, ceiling };
      }
      return { over: false, live, spendAfter: addSpend(clusterId, estimatedCost) };
    });
  // auto: re-check the ceiling atomically (Redis Lua across instances) or inside a
  // per-process lock so parallel calls cannot all pass
  const charged = await withSpan("bleedstop.ledger.charge", { "bleedstop.atomic": atomicMode() || pgBudgetEnabled(), "bleedstop.cost_usd": estimatedCost, "bleedstop.budget_store": pgBudgetEnabled() ? "postgres" : (atomicMode() ? "redis" : "memory") }, async () => {
    if (pgBudgetEnabled()) {
      const ceiling = evaluation.ceilingUsd ?? getSpendCeilingUsd(paid);
      const r = await atomicPgSpend({ clusterId, amount: estimatedCost, ceiling });
      if (r.spend != null) setLocalSpend(clusterId, r.spend);
      return r.ok
        ? { over: false, live: Math.max(0, r.spend - estimatedCost), spendAfter: r.spend, ceiling }
        : { over: true, live: r.spend, ceiling };
    }
    return atomicMode()
      ? await shared(async () => {
          const ceiling = evaluation.ceilingUsd ?? getSpendCeilingUsd(paid);
          const r = await atomicCharge(clusterId, estimatedCost, ceiling);
          setLocalSpend(clusterId, r.spendUsd);
          return r.ok
            ? { over: false, live: Math.max(0, r.spendUsd - estimatedCost), spendAfter: r.spendUsd }
            : { over: true, live: r.spendUsd, ceiling };
        }, localCharge)
      : await localCharge();
  });

  if (charged.over) {
    const denied = denyResult({
      actorId,
      clusterId,
      vendorKeyId,
      action: finalAction,
      reason: `Parallel guard: would exceed ceiling $${charged.ceiling} (now $${charged.live})`,
      paid,
      phoneCountry,
      ipCountry,
      estimatedCost,
      spendBefore: charged.live,
    });
    incDecide("DENY", { latencyMs: performance.now() - started });
    return denied;
  }

  if (finalAction.startsWith("llm")) {
    if (atomicMode()) await shared(() => velocityIncr(clusterId), () => recordCall(`${clusterId}:llm`));
    else recordCall(`${clusterId}:llm`);
  }
  if (!paid && network.subnet) {
    if (atomicMode() && estimatedCost) await shared(() => addPoolSpendShared(network.subnet, estimatedCost, NETWORK_WINDOW_MS), () => addPoolSpend(network.subnet, estimatedCost));
    else addPoolSpend(network.subnet, estimatedCost);
  }
  const spendAfter = charged.spendAfter;
  const spendBeforeLocked = charged.live;
  if (vendorKeyId) {
    addAppKeySpend(vendorKeyId, estimatedCost);
    const vendor = recordVendorUsage(vendorKeyId, estimatedCost);
    if (!vendor.ok) {
      const denied = denyResult({
        actorId,
        clusterId,
        vendorKeyId,
        action: finalAction,
        reason: vendor.reason,
        paid,
        phoneCountry,
        ipCountry,
        estimatedCost,
        spendBefore,
      });
      incDecide("DENY", { latencyMs: performance.now() - started });
      return denied;
    }
  }

  const event = appendEvent({
    type: "decision",
    decision: evaluation.decision,
    actorId,
    clusterId,
    action: finalAction,
    originalAction: action,
    estimatedCost,
    actualCost: estimatedCost,
    spendBefore,
    spendAfter,
    vendorKeyId: vendorKeyId ?? null,
    paid,
    phoneCountry,
    ipCountry,
    idempotencyKey: key,
    matchedRules: evaluation.matchedRules,
    shadowHits: evaluation.shadowHits,
  });

  const ceilingUsd = evaluation.ceilingUsd ?? getSpendCeilingUsd(paid);
  const out = {
    decision: evaluation.decision,
    clusterId,
    vendorKeyId: vendorKeyId ?? null,
    action: finalAction,
    estimatedCost,
    spendBefore,
    spendAfter,
    ceilingUsd,
    idempotencyKey: key,
    limit: evaluation.limit,
    matchedRules: evaluation.matchedRules,
    shadowHits: evaluation.shadowHits,
    reason:
      evaluation.decision === "LIMIT"
        ? evaluation.matchedRules.find((m) => m.decision === "LIMIT")?.reason ||
          `Limited; cluster bill ${spendAfter}/${ceilingUsd}`
        : paid
          ? `Paying actor in ${clusterId} under paid ceiling ($${spendAfter.toFixed(3)} / $${ceilingUsd}).`
          : `Cluster ${clusterId} under unpaid ceiling ($${spendAfter.toFixed(3)} / $${ceilingUsd}).`,
    eventId: event.id,
    agentCheck: agentCheck ?? undefined,
    ...(agentCheck?.detector ? { detector: agentCheck.detector } : {}),
  };

  if (idempotencyKey) setIdempotentResult(idempotencyKey, out);
  incDecide(evaluation.decision, { latencyMs: performance.now() - started });
  enqueue({
    type: "decision",
    decision: evaluation.decision,
    clusterId,
    actorId,
    action: finalAction,
  });
  return out;
}

export async function decide(input) {
  const row = await decideInner(input);
  try {
    recordAudit({
      action: "decide",
      actor: String(input?.actorId || "unknown"),
      target: String(input?.action || ""),
      meta: {
        tenantId: getTenantId(),
        decision: row?.decision || null,
        reason: row?.reason ? String(row.reason).slice(0, 300) : null,
        clusterId: row?.clusterId || null,
      },
    });
  } catch {
    // A failed audit must not change the decision the caller already earned.
  }
  return row;
}

function denyResult(opts) {
  const event = appendEvent({
    type: "decision",
    decision: "DENY",
    actorId: opts.actorId,
    clusterId: opts.clusterId,
    action: opts.action,
    estimatedCost: opts.estimatedCost ?? null,
    spendBefore: opts.spendBefore ?? getSpend(opts.clusterId),
    spendAfter: null,
    vendorKeyId: opts.vendorKeyId ?? null,
    paid: opts.paid,
    phoneCountry: opts.phoneCountry,
    ipCountry: opts.ipCountry,
    matchedRules: opts.matchedRules ?? [],
    shadowHits: opts.shadowHits ?? [],
  });

  return {
    decision: "DENY",
    clusterId: opts.clusterId,
    vendorKeyId: opts.vendorKeyId ?? null,
    action: opts.action,
    reason: opts.reason,
    estimatedCost: opts.estimatedCost ?? null,
    spendBefore: opts.spendBefore ?? getSpend(opts.clusterId),
    spendAfter: null,
    matchedRules: opts.matchedRules ?? [],
    shadowHits: opts.shadowHits ?? [],
    eventId: event.id,
    agentCheck: opts.agentCheck ?? undefined,
  };
}

function maybeRecordClusterIncident(clusterId, evaluation, spendBefore) {
  const ceilingHit = evaluation.matchedRules.some(
    (m) =>
      m.ruleId === "R-ceiling" ||
      m.ruleId === "R-paid-ceiling" ||
      String(m.reason).includes("ceiling")
  );
  if (!ceilingHit) return;
  recordIncident({
    type: "cluster_abuse",
    severity: "medium",
    clusterId,
    spendBefore,
    action: "deny_unpaid_ceiling",
    dollarsLostEst: spendBefore,
    message: `Cluster ${clusterId} hit ceiling and was denied.`,
  });
}
