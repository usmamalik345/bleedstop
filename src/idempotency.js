/**
 * In-memory idempotency cache for /decide auto path.
 * Same idempotencyKey → same result, no double charge.
 */

/** @type {Map<string, object>} */
const completed = new Map();
const MAX = 5000;

export function getIdempotentResult(key) {
  if (!key) return null;
  return completed.get(key) || null;
}

export function setIdempotentResult(key, result) {
  if (!key) return;
  completed.set(key, { ...result, replay: true, idempotent: true });
  if (completed.size > MAX) {
    const first = completed.keys().next().value;
    completed.delete(first);
  }
}

export function resetIdempotency() {
  completed.clear();
}
