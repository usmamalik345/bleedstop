/**
 * Redis-backed cluster spend (shared across API pods).
 * Money amounts stored as integer cents to avoid float drift.
 */

import { getRedis, redisEnabled, disableRedis } from "./redis.js";
import { getTenantId } from "../tenant/context.js";
import { roundMoney } from "../utils/money.js";

function spendKey(clusterId) {
  return `bleedstop:${getTenantId()}:spend:${clusterId}`;
}

function cents(dollars) {
  return Math.round(Number(dollars) * 1000); // millicents-ish: 3 decimal $ → int
}

function dollars(centsVal) {
  return roundMoney(Number(centsVal) / 1000);
}

/** Read shared spend for one cluster (0 if Redis off / miss). */
export async function redisGetSpend(clusterId) {
  if (!redisEnabled()) return null;
  try {
    const r = await getRedis();
    if (!r) return null;
    const raw = await r.get(spendKey(clusterId));
    if (raw == null) return null;
    return dollars(raw);
  } catch (err) {
    disableRedis(err.message);
    return null;
  }
}

/** Atomically add dollars to shared counter. Returns new total or null. */
export async function redisIncrSpend(clusterId, dollarsToAdd) {
  if (!redisEnabled()) return null;
  try {
    const r = await getRedis();
    if (!r) return null;
    const next = await r.incrby(spendKey(clusterId), cents(dollarsToAdd));
    return dollars(next);
  } catch (err) {
    disableRedis(err.message);
    return null;
  }
}

/** Force-set (hydrate / reset). */
export async function redisSetSpend(clusterId, dollarsVal) {
  if (!redisEnabled()) return;
  try {
    const r = await getRedis();
    if (!r) return;
    await r.set(spendKey(clusterId), String(cents(dollarsVal)));
  } catch (err) {
    disableRedis(err.message);
  }
}

/** Wipe this tenant's spend keys. Used by reset so old bills don't come back. */
export async function redisClearTenantSpend() {
  if (!redisEnabled()) return 0;
  try {
    const r = await getRedis();
    if (!r) return 0;
    const pattern = `bleedstop:${getTenantId()}:spend:*`;
    let cursor = "0";
    let removed = 0;
    do {
      const [next, keys] = await r.scan(cursor, "MATCH", pattern, "COUNT", 200);
      cursor = next;
      if (keys.length) {
        await r.del(...keys);
        removed += keys.length;
      }
    } while (cursor !== "0");
    return removed;
  } catch (err) {
    disableRedis(err.message);
    return 0;
  }
}

export async function redisDelSpend(clusterId) {
  if (!redisEnabled()) return;
  try {
    const r = await getRedis();
    if (!r) return;
    await r.del(spendKey(clusterId));
  } catch (err) {
    disableRedis(err.message);
  }
}
