/**
 * Tiny write queue so hot-path code can stay simple,
 * while every change is still saved to Postgres in order.
 */

let queue = Promise.resolve();

export function enqueuePersist(label, fn) {
  queue = queue
    .then(fn)
    .catch((err) => {
      console.error(`[persist:${label}]`, err.message);
    });
  return queue;
}

export async function flushPersist() {
  await queue;
  const { drain } = await import("./writeBehind.js");
  await drain();
  await queue;
}
