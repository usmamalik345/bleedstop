/**
 * Token-bucket rate limit for /decide itself (protects the control plane, ADR-0007).
 * Bucket key = tenant + caller (API key id or remote IP). Limits come from tenant policy.
 * Per process; behind N instances the effective limit is N x rate (documented).
 */
/** @type {Map<string, { tokens: number, at: number }>} */
const buckets = new Map();

export function take(key, ratePerSec, burst, now = performance.now()) {
  if (!(ratePerSec > 0)) return { ok: true, remaining: Infinity };
  let b = buckets.get(key);
  if (!b) { b = { tokens: burst, at: now }; buckets.set(key, b); }
  b.tokens = Math.min(burst, b.tokens + ((now - b.at) / 1000) * ratePerSec);
  b.at = now;
  if (b.tokens < 1) return { ok: false, retryAfterSec: Math.ceil((1 - b.tokens) / ratePerSec) };
  b.tokens -= 1;
  if (buckets.size > 100_000) buckets.delete(buckets.keys().next().value);
  return { ok: true, remaining: Math.floor(b.tokens) };
}

export function resetRateLimit() { buckets.clear(); }
