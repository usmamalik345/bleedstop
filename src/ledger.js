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
import { getTenantId } from "./tenant/context.js";

/** @type {Record<string, number>} */
const spendByCluster = {};

/** @type {Record<string, { clusterId: string, tenantId: string, amount: number, expiresAt: number }>} */
const reservations = {};

const sep = "\u0000";
function spendKey(clusterId) { return `${getTenantId()}${sep}${clusterId}`; }
function resKey(idempotencyKey) { return `${getTenantId()}${sep}${idempotencyKey}`; }

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
  wbSpend(clusterId, spendByCluster[spendKey(clusterId)] ?? 0);
}

function persistReservations() {
  if (!dbEnabled()) return;
  const prefix = `${getTenantId()}${sep}`;
  const mine = {};
  for (const [k, row] of Object.entries(reservations)) {
    if (k.startsWith(prefix)) mine[k.slice(prefix.length)] = row;
  }
  enqueuePersist("reservations", () => replaceReservations(mine));
}

export function getSpend(clusterId) {
  expireReservations();
  const tenant = getTenantId();
  const committed = spendByCluster[spendKey(clusterId)] ?? 0;
  const reserved = Object.values(reservations)
    .filter((r) => r.clusterId === clusterId && r.tenantId === tenant)
    .reduce((sum, r) => sum + r.amount, 0);
  return roundMoney(committed + reserved);
}

/** Mirror a shared (Redis) total into local memory without pushing a delta back. */
export function setLocalSpend(clusterId, usd) {
  spendByCluster[spendKey(clusterId)] = roundMoney(usd);
  persistSpend(clusterId);
}

export function getCommittedSpend(clusterId) {
  return spendByCluster[spendKey(clusterId)] ?? 0;
}

export function reserve(clusterId, amount, idempotencyKey) {
  expireReservations();
  const key = resKey(idempotencyKey);
  if (reservations[key]) {
    return { ...reservations[key], replay: true };
  }
  const row = {
    clusterId,
    tenantId: getTenantId(),
    amount: roundMoney(amount),
    expiresAt: Date.now() + config.reserveTtlMs,
    replay: false,
  };
  reservations[key] = row;
  persistReservations();
  return row;
}

export function commit(idempotencyKey, actualCost) {
  expireReservations();
  const key = resKey(idempotencyKey);
  const res = reservations[key];
  if (!res) {
    throw new Error(`Unknown or expired reservation: ${idempotencyKey}`);
  }
  const cost = roundMoney(actualCost);
  const sk = `${res.tenantId}${sep}${res.clusterId}`;
  spendByCluster[sk] = roundMoney((spendByCluster[sk] ?? 0) + cost);
  delete reservations[key];
  persistSpend(res.clusterId);
  persistReservations();
  void pushSpendDelta(res.clusterId, cost);
  return {
    clusterId: res.clusterId,
    actualCost: cost,
    spendAfter: spendByCluster[sk],
  };
}

export function addSpend(clusterId, dollars) {
  const sk = spendKey(clusterId);
  spendByCluster[sk] = roundMoney((spendByCluster[sk] ?? 0) + dollars);
  persistSpend(clusterId);
  void pushSpendDelta(clusterId, dollars);
  return spendByCluster[sk];
}

/**
 * Pull Redis spend into this process before we decide.
 * Like checking the shared group tab before ordering more food.
 */
export async function syncSpendFromRedis(clusterId) {
  if (!redisEnabled()) return getCommittedSpend(clusterId);
  const remote = await redisGetSpend(clusterId);
  const local = spendByCluster[spendKey(clusterId)] ?? 0;

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
    spendByCluster[spendKey(clusterId)] = remote;
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
  delete reservations[resKey(idempotencyKey)];
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
  const prefix = `${getTenantId()}${sep}`;
  const out = {};
  for (const [k, v] of Object.entries(spendByCluster)) {
    if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
  }
  return out;
}

export function listReservations() {
  expireReservations();
  const prefix = `${getTenantId()}${sep}`;
  const out = {};
  for (const [k, row] of Object.entries(reservations)) {
    if (k.startsWith(prefix)) out[k.slice(prefix.length)] = row;
  }
  return out;
}

/** Load from Postgres into memory (boot). Rows belong to the tenant that was current at boot. */
export function hydrateLedger({ spend = {}, reservationsMap = {} } = {}) {
  resetLedger();
  const t = getTenantId();
  for (const [id, v] of Object.entries(spend)) spendByCluster[`${t}${sep}${id}`] = v;
  for (const [k, row] of Object.entries(reservationsMap)) {
    reservations[`${t}${sep}${k}`] = { ...row, tenantId: row.tenantId || t };
  }
}
