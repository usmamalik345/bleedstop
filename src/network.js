/**
 * Network signals: IP → subnet (/24 IPv4, /64 IPv6) and ASN spread.
 *
 * Safeguards for shared NAT (ADR-0003):
 *  - IP/subnet is NEVER used to union identities (a household or office NAT would merge).
 *  - A subnet only becomes a shared "pool budget" after subnetPoolMinActors distinct
 *    unpaid actors have been seen in it inside the window. Small households never qualify.
 *  - The pool has its own ceiling; it does not add velocity limits (offices stay fast).
 *  - ASN spread (new actors from one ASN across many /24s) defaults to shadow mode,
 *    because big consumer ISPs look like that too.
 *  - SUBNET_ALLOWLIST / ASN_ALLOWLIST skip both checks (known CGNAT, corporate egress).
 * State is per process in memory mode. With Redis (atomic mode) the actor/subnet sets and the
 * pool spend are shared across instances (redisShared.observeNetworkShared); before that, a
 * round robin LB split each subnet across replicas and the pool rule almost never fired
 * (measured: rotated_same_subnet recall 66.7% on 1 instance, 0.15% on 3 replicas).
 */
import net from "node:net";

export const WINDOW_MS = Number(process.env.NETWORK_WINDOW_MS || 10 * 60_000);
const subnetAllow = new Set((process.env.SUBNET_ALLOWLIST || "").split(",").map((s) => s.trim()).filter(Boolean));
const asnAllow = new Set((process.env.ASN_ALLOWLIST || "").split(",").map((s) => s.trim()).filter(Boolean));

/** @type {Map<string, Map<string, number>>} subnet → actor → lastSeen */
const subnetActors = new Map();
/** @type {Map<string, Map<string, number>>} asn → subnet → lastSeen */
const asnSubnets = new Map();
/** @type {Map<string, number>} subnet pool spend (USD) */
const poolSpend = new Map();

function expandV6(ip) {
  const [head, tail = ""] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const fill = ip.includes("::") ? Array(8 - h.length - t.length).fill("0") : [];
  return [...h, ...fill, ...t].map((x) => x.padStart(4, "0").toLowerCase());
}

/** "203.0.113.7" → "203.0.113.0/24"; IPv6 → first 4 hextets "/64"; invalid → null */
export function subnetOf(ip) {
  if (!ip || typeof ip !== "string") return null;
  let s = ip.trim();
  if (s.startsWith("::ffff:") && net.isIPv4(s.slice(7))) s = s.slice(7);
  if (net.isIPv4(s)) return s.split(".").slice(0, 3).join(".") + ".0/24";
  if (net.isIPv6(s)) return expandV6(s).slice(0, 4).join(":") + "::/64";
  return null;
}

function touch(map, key, member, now) {
  let m = map.get(key);
  if (!m) map.set(key, (m = new Map()));
  m.set(member, now);
  for (const [k, t] of m) if (now - t > WINDOW_MS) m.delete(k);
  return m.size;
}

/**
 * Record one request's network signals; returns derived facts for the rule engine.
 * @returns {{ subnet: string|null, subnetActors: number, asn: string|null, asnSubnets: number, allowlisted: boolean }}
 */
export function observeNetwork({ actorId, ip, asn, paid = false }, now = Date.now()) {
  const subnet = subnetOf(ip);
  const asnKey = asn ? String(asn) : null;
  const allowlisted = (subnet && subnetAllow.has(subnet)) || (asnKey && asnAllow.has(asnKey));
  let nActors = 0;
  let nSubnets = 0;
  if (subnet && !paid) nActors = touch(subnetActors, subnet, actorId, now);
  if (asnKey && subnet && !paid) nSubnets = touch(asnSubnets, asnKey, subnet, now);
  return { subnet, subnetActors: nActors, asn: asnKey, asnSubnets: nSubnets, allowlisted: Boolean(allowlisted) };
}

export const getPoolSpend = (subnet) => poolSpend.get(subnet) || 0;
export function addPoolSpend(subnet, usd) {
  if (!subnet || !usd) return;
  poolSpend.set(subnet, Math.round((getPoolSpend(subnet) + usd) * 1e6) / 1e6);
}

export function resetNetwork() {
  subnetActors.clear();
  asnSubnets.clear();
  poolSpend.clear();
}
