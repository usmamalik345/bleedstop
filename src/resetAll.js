import { resetLedger } from "./ledger.js";
import { resetClusters } from "./cluster.js";
import { resetKeyLedger } from "./keyLedger.js";
import { resetVendorMock } from "./vendorMock.js";
import { resetIncidents } from "./incidents.js";
import { resetEvents } from "./eventLog.js";
import { resetProposals } from "./rules/store.js";
import { resetIdempotency } from "./idempotency.js";
import { resetMetrics } from "./metrics.js";
import { resetRunbooks } from "./runbooks.js";
import { resetQueue } from "./queue/memoryQueue.js";
import { resetVelocity } from "./velocity.js";
import { resetNetwork } from "./network.js";
import { resetAgentGuard } from "./agentGuard.js";
import { resetRateLimit } from "./rateLimit.js";
import { redisEnabled } from "./db/redis.js";
import { clearShared } from "./db/redisShared.js";
import { redisClearTenantSpend } from "./db/redisCounters.js";
import { dbEnabled } from "./db/postgres.js";
import { clearTenantData } from "./db/repository.js";
import { flushPersist } from "./db/persistQueue.js";
import {
  upsertVendorKey,
} from "./db/repository.js";

export async function resetAll() {
  await flushPersist();

  resetLedger();
  resetClusters();
  resetKeyLedger();
  resetVendorMock();
  resetIncidents();
  resetEvents();
  resetProposals();
  resetIdempotency();
  resetMetrics();
  resetRunbooks();
  resetQueue();
  resetVelocity();
  resetNetwork();
  resetAgentGuard();
  resetRateLimit();
  if (redisEnabled()) await clearShared();
  await redisClearTenantSpend();

  if (dbEnabled()) {
    await clearTenantData();
    await upsertVendorKey("gm-demo-key", 0, "active");
    await upsertVendorKey("oa-demo-key", 0, "active");
    await upsertVendorKey("oa-live-key", 0, "active");
    await upsertVendorKey("tw-demo-key", 0, "active");
  }
}
