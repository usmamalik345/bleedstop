/**
 * Tiny in-process queue (stand-in for RabbitMQ in the PDF).
 * Failed jobs go to a dead-letter list you can replay.
 */

/** @type {object[]} */
const ready = [];
/** @type {object[]} */
const dead = [];
let seq = 0;

export function enqueue(job) {
  const row = {
    id: `job-${++seq}`,
    at: new Date().toISOString(),
    attempts: 0,
    ...job,
  };
  ready.push(row);
  return row;
}

export function queueStats() {
  return { ready: ready.length, dead: dead.length };
}

/** Process up to `limit` jobs. handler throws → dead letter. */
export async function drain(handler, { limit = 100 } = {}) {
  let done = 0;
  let failed = 0;
  while (ready.length && done + failed < limit) {
    const job = ready.shift();
    job.attempts += 1;
    try {
      await handler(job);
      done += 1;
    } catch (err) {
      job.error = err.message;
      dead.push(job);
      failed += 1;
    }
  }
  return { done, failed, ...queueStats() };
}

export function replayDead() {
  const n = dead.length;
  while (dead.length) ready.push(dead.shift());
  return { requeued: n };
}

export function resetQueue() {
  ready.length = 0;
  dead.length = 0;
  seq = 0;
}
