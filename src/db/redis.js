/**
 * Optional Redis for shared cluster counters across pods.
 * Falls back to null when REDIS_URL is empty.
 */

import { config } from "../config.js";

let client = null;

export function redisEnabled() {
  return Boolean(config.redisUrl);
}

/** Fall back when Redis is unreachable (Docker off). */
export function disableRedis(reason) {
  if (!config.redisUrl) return;
  config.redisUrl = "";
  if (client) {
    client.disconnect();
    client = null;
  }
  if (reason) console.warn(`Redis disabled → skip shared counters (${reason})`);
}

export async function getRedis() {
  if (!config.redisUrl) return null;
  if (client) return client;

  const Redis = (await import("ioredis")).default;
  client = new Redis(config.redisUrl, {
    maxRetriesPerRequest: 2,
    lazyConnect: true,
  });
  await client.connect();
  return client;
}

export async function closeRedis() {
  if (client) {
    await client.quit();
    client = null;
  }
}
