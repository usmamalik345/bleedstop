/**
 * Rolling-window call counter per cluster+action (in memory, O(1) amortised).
 * Used by the llm_velocity rule to stop retry storms and agent loops early.
 */

/** @type {Map<string, number[]>} */
const windows = new Map();

export function countRecent(key, windowMs = 60_000, now = Date.now()) {
  const arr = windows.get(key);
  if (!arr) return 0;
  while (arr.length && now - arr[0] >= windowMs) arr.shift();
  return arr.length;
}

export function recordCall(key, now = Date.now()) {
  if (!windows.has(key)) windows.set(key, []);
  windows.get(key).push(now);
}

export function resetVelocity() {
  windows.clear();
}
