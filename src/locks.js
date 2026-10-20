/**
 * One-at-a-time lock per cluster.
 * Stops 50 parallel requests all seeing "$1 left" and all spending.
 */

/** @type {Map<string, Promise<void>>} */
const tails = new Map();

export function withClusterLock(clusterId, fn) {
  const prev = tails.get(clusterId) || Promise.resolve();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  // Next caller waits for this one, even if fn throws
  const tail = prev.then(() => gate);
  tails.set(clusterId, tail);

  return prev.then(async () => {
    try {
      return await fn();
    } finally {
      release();
      if (tails.get(clusterId) === tail) tails.delete(clusterId);
    }
  });
}

export function resetLocks() {
  tails.clear();
}
