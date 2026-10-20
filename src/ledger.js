/**
 * Cluster ledger + reservations.
 * Fast path uses memory; every change is also saved to Postgres when DATABASE_URL is set.
 * When Redis is on, cluster spend is shared across API pods (multi-instance ceilings).
 */

import { config } from "./config.js";
import { roundMoney } from "./utils/money.js";
import { dbEnabled } from "./db/postgres.js";
import { replaceReservations } from "./db/repository.js";
import { wbSpend } from "./db/writeBehind.js";
import { enqueuePersist } from "./db/persistQueue.js";
import {
  redisGetSpend,
  redisIncrSpend,
  redisSetSpend,
} from "./db/redisCounters.js";
import { redisEnabled } from "./db/redis.js";
import { incRedisSpendSync } from "./metrics.js";
import { getPolicy } from "./policy.js";

/** @type {Record<string, number>} */
const spendByCluster = {};

/** @type {Record<string, { clusterId: string, amount: number, expiresAt: number }>} */
const reservations = {};

export const UNPAID_CEILING_USD = config.unpaidCeilingUsd;
export const PAID_CEILING_USD = config.paidCeilingUsd;

/** Which $ ceiling applies to this request? */
export function getSpendCeilingUsd(paid = false) {
  const p = getPolicy(); // per-tenant budgets (policy.js)
  return paid ? p.paidCeilingUsd : p.unpaidCeilingUsd;
}

function persistSpend(clusterId) {
  if (!dbEnabled()) return;
  // Postgres budget mode already wrote the row inside the locked UPDATE.
  // A later absolute write would put a stale total back.
  if (process.env.BUDGET_STORE === "postgres") return;
  wbSpend(clusterId, spendByCluster[clusterId] ?? 0);
}

function persistReservations() {
  if (!dbEnabled()) return;
  enqueuePersist("reservations", () => replaceReservations(reservations));
}

export function getSpend(clusterId) {
  expireReservations();
  const committed = spendByCluster[clusterId] ?? 0;
  const reserved = Object.values(reservations)
    .filter((r) => r.clusterId === clusterId)
    .reduce((sum, r) => sum + r.amount, 0);
  return roundMoney(committed + reserved);
}

/** Mirror a shared (Redis) total into local memory without pushing a delta back. */
export function setLocalSpend(clusterId, usd) {
  spendByCluster[clusterId] = roundMoney(usd);
  persistSpend(clusterId);
}

export function getCommittedSpend(clusterId) {
  return spendByCluster[clusterId] ?? 0;
}

export function reserve(clusterId, amount, idempotencyKey) {
  expireReservations();
  if (reservations[idempotencyKey]) {
    return { ...reservations[idempotencyKey], replay: true };
  }
  const row = {
    clusterId,
    amount: roundMoney(amount),
    expiresAt: Date.now() + config.reserveTtlMs,
    replay: false,
  };
  reservations[idempotencyKey] = row;
  persistReservations();
  return row;
}

export function commit(idempotencyKey, actualCost) {
  expireReservations();
  const res = reservations[idempotencyKey];
  if (!res) {
    throw new Error(`Unknown or expired reservation: ${idempotencyKey}`);
  }
  const cost = roundMoney(actualCost);
  spendByCluster[res.clusterId] = roundMoney(
    (spendByCluster[res.clusterId] ?? 0) + cost
  );
  delete reservations[idempotencyKey];
  persistSpend(res.clusterId);
  persistReservations();
  // Shared counter for other pods (fire-and-forget; decide awaits pushSpendDelta)
  void pushSpendDelta(res.clusterId, cost);
  return {
    clusterId: res.clusterId,
    actualCost: cost,
    spendAfter: spendByCluster[res.clusterId],
  };
}

export function addSpend(clusterId, dollars) {
  spendByCluster[clusterId] = roundMoney(
    (spendByCluster[clusterId] ?? 0) + dollars
  );
  persistSpend(clusterId);
  void pushSpendDelta(clusterId, dollars);
  return spendByCluster[clusterId];
}

/**
 * Pull Redis spend into this process before we decide.
 * Like checking the shared group tab before ordering more food.
 */
export async function syncSpendFromRedis(clusterId) {
  if (!redisEnabled()) return getCommittedSpend(clusterId);
  const remote = await redisGetSpend(clusterId);
  const local = spendByCluster[clusterId] ?? 0;

  if (remote == null) {
    // First time Redis sees this cluster — seed it from memory
    if (local > 0) {
      await redisSetSpend(clusterId, local);
      incRedisSpendSync();
    }
    return local;
  }

  if (remote > local) {
    // Another pod already spent more — trust the shared counter
    spendByCluster[clusterId] = remote;
    persistSpend(clusterId);
    incRedisSpendSync();
    return remote;
  }

  return local;
}

/** Atomically add to Redis after a local charge. */
export async function pushSpendDelta(clusterId, dollars) {
  if (!redisEnabled() || !dollars) return null;
  const next = await redisIncrSpend(clusterId, dollars);
  if (next != null) incRedisSpendSync();
  return next;
}

export function releaseReservation(idempotencyKey) {
  delete reservations[idempotencyKey];
  persistReservations();
}

function expireReservations() {
  const now = Date.now();
  let changed = false;
  for (const [key, row] of Object.entries(reservations)) {
    if (row.expiresAt <= now) {
      delete reservations[key];
      changed = true;
    }
  }
  if (changed) persistReservations();
}

export function resetLedger() {
  for (const key of Object.keys(spendByCluster)) delete spendByCluster[key];
  for (const key of Object.keys(reservations)) delete reservations[key];
}

export function listSpend() {
  expireReservations();
  return { ...spendByCluster };
}

export function listReservations() {
  expireReservations();
  return { ...reservations };
}

/** Load from Postgres into memory (boot). */
export function hydrateLedger({ spend = {}, reservationsMap = {} } = {}) {
  resetLedger();
  Object.assign(spendByCluster, spend);
  Object.assign(reservations, reservationsMap);
}
