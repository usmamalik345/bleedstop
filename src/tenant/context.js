/**
 * Request-scoped tenant (AsyncLocalStorage).
 * Like a sticky note on the current request — DB + auth know which customer.
 */

import { AsyncLocalStorage } from "async_hooks";
import { config } from "../config.js";

const als = new AsyncLocalStorage();

/** Active tenant for this async chain, else process default. */
export function getTenantId() {
  return als.getStore()?.tenantId || config.tenantId || "local-dev";
}

/** Run fn with a fixed tenant (used by API-key middleware). */
export function runWithTenant(tenantId, fn) {
  return als.run({ tenantId }, fn);
}
