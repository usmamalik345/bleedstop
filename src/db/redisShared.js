/**
 * Redis-backed shared state for multi-instance mode (ADR-0004).
 *  - Identity graph: signal owners via SETNX, union-find parents in a hash, so every
 *    instance derives the SAME cluster id for the same actor.
 *  - Atomic ceiling: one Lua script does "read spend, compare to ceiling, INCRBY" so two
 *    instances can never both pass with the last dollar.
 *  - LLM velocity: per-cluster fixed 60s window counter (INCR + PEXPIRE).
 * Amounts are integer micro-dollars (1e-6 USD).
 */
import crypto from "node:crypto";
import { getRedis } from "./redis.js";
import { getTenantId } from "../tenant/context.js";

const k = (...p) => `bleedstop:${getTenantId()}:${p.join(":")}`;
const micro = (usd) => Math.round(Number(usd) * 1e6);

const CHARGE_LUA = `
local cur = tonumber(redis.call('GET', KEYS[1]) or '0')
local cost = tonumber(ARGV[1])
local ceil = tonumber(ARGV[2])
if cur + cost > ceil then return {0, cur} end
local nxt = redis.call('INCRBY', KEYS[1], cost)
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return {1, nxt}`;

async function findRoot(r, actor) {
  let cur = actor;
  for (let i = 0; i < 32; i++) {
    const p = await r.hget(k("uf"), cur);
    if (!p || p === cur) return cur;
    cur = p;
  }
  return cur;
}

/**
 * Shared Union-Find over device/email/asn signals. Returns a stable cluster id.
 * Root choice is "oldest wins": the first actor that claimed a signal (SETNX) stays
 * the root, so concurrent requests on any instance converge on the same id. Only when
 * two existing clusters merge (e.g. an email links two devices) is the lexical-min root
 * picked; the other cluster's id then folds into it.
 */
export async function resolveClusterShared(actorId, signalKeys) {
  const r = await getRedis();
  const owners = [];
  for (const key of signalKeys) {
    const set = await r.set(k("sig", key), actorId, "NX");
    owners.push(set ? actorId : await r.get(k("sig", key)));
  }
  const ownerRoots = [];
  for (const o of owners) if (o !== actorId) ownerRoots.push(await findRoot(r, o));
  let root;
  if (ownerRoots.length) {
    const uniq = [...new Set(ownerRoots)].sort();
    root = uniq[0];
    for (const other of uniq.slice(1)) await r.hset(k("uf"), other, root);
    const mine = await findRoot(r, actorId);
    if (mine !== root && mine !== actorId) await r.hset(k("uf"), mine, root);
    await r.hset(k("uf"), actorId, root);
  } else {
    root = await findRoot(r, actorId);
  }
  return "C-" + crypto.createHash("sha1").update(root).digest("hex").slice(0, 10);
}

/** Atomic check-and-charge against the ceiling. */
export async function atomicCharge(clusterId, costUsd, ceilingUsd, ttlMs = 86_400_000) {
  const r = await getRedis();
  const [ok, total] = await r.eval(CHARGE_LUA, 1, k("spend", clusterId), micro(costUsd), micro(ceilingUsd), ttlMs);
  return { ok: ok === 1, spendUsd: Number(total) / 1e6 };
}

export async function velocityIncr(clusterId, windowMs = 60_000) {
  const r = await getRedis();
  const key = k("vel", clusterId, Math.floor(Date.now() / windowMs));
  const n = await r.incr(key);
  if (n === 1) await r.pexpire(key, windowMs * 2);
  return n;
}

export async function velocityPeek(clusterId, windowMs = 60_000) {
  const r = await getRedis();
  return Number((await r.get(k("vel", clusterId, Math.floor(Date.now() / windowMs)))) || 0);
}

export async function sharedSpend(clusterId) {
  const r = await getRedis();
  return Number((await r.get(k("spend", clusterId))) || 0) / 1e6;
}

/** Remove this tenant's shared keys (reset). */
export async function clearShared() {
  const r = await getRedis();
  let cursor = "0";
  do {
    const [next, keys] = await r.scan(cursor, "MATCH", `bleedstop:${getTenantId()}:*`, "COUNT", 500);
    cursor = next;
    if (keys.length) await r.del(...keys);
  } while (cursor !== "0");
}

/**
 * Shared network signals (subnet pools, ASN spread) across instances.
 * Sorted sets scored by last seen time give a sliding window distinct count.
 */
export async function observeNetworkShared({ actorId, subnet, asn }, windowMs, now = Date.now()) {
  const r = await getRedis();
  const m = r.multi();
  const sa = k("net", "sa", subnet);
  m.zadd(sa, now, actorId).zremrangebyscore(sa, 0, now - windowMs).zcard(sa).pexpire(sa, windowMs);
  let asnKey = null;
  if (asn) {
    asnKey = k("net", "as", asn);
    m.zadd(asnKey, now, subnet).zremrangebyscore(asnKey, 0, now - windowMs).zcard(asnKey).pexpire(asnKey, windowMs);
  }
  m.get(k("net", "pool", subnet));
  const res = await m.exec();
  const val = (i) => { if (res[i][0]) throw res[i][0]; return res[i][1]; };
  const subnetActors = Number(val(2));
  const asnSubnets = asnKey ? Number(val(6)) : 0;
  const poolSpendUsd = Number(val(asnKey ? 8 : 4) || 0) / 1e6;
  return { subnetActors, asnSubnets, poolSpendUsd };
}

export async function addPoolSpendShared(subnet, usd, windowMs) {
  const r = await getRedis();
  const key = k("net", "pool", subnet);
  await r.multi().incrby(key, micro(usd)).pexpire(key, windowMs).exec();
}
