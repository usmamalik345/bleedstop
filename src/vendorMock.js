/**
 * Mock vendor usage + key status.
 * When DATABASE_URL is set, values are stored in Postgres table vendor_keys.
 */

import { roundMoney } from "./utils/money.js";
import { dbEnabled } from "./db/postgres.js";
import { upsertVendorKey } from "./db/repository.js";
import { enqueuePersist } from "./db/persistQueue.js";

/** @type {Record<string, number>} */
const vendorUsageByKey = {};

/** @type {Record<string, "active" | "disabled">} */
const keyStatus = {
  "gm-demo-key": "active",
  "oa-demo-key": "active",
  "oa-live-key": "active",
  "tw-demo-key": "active",
  "stripe-live-key": "active",
};

function persistKey(keyId) {
  if (!dbEnabled()) return;
  enqueuePersist("vendor_key", () =>
    upsertVendorKey(
      keyId,
      vendorUsageByKey[keyId] ?? 0,
      keyStatus[keyId] ?? "active"
    )
  );
}

export function recordVendorUsage(keyId, dollars) {
  if (getKeyStatus(keyId) === "disabled") {
    return { ok: false, reason: `Key ${keyId} is disabled (kill switch).` };
  }
  vendorUsageByKey[keyId] = roundMoney((vendorUsageByKey[keyId] ?? 0) + dollars);
  persistKey(keyId);
  return { ok: true, total: vendorUsageByKey[keyId] };
}

export function getVendorUsage(keyId) {
  return vendorUsageByKey[keyId] ?? 0;
}

export function listVendorUsage() {
  return { ...vendorUsageByKey };
}

export function getKeyStatus(keyId) {
  return keyStatus[keyId] ?? "active";
}

export function listKeyStatus() {
  return { ...keyStatus };
}

export function disableKey(keyId) {
  keyStatus[keyId] = "disabled";
  persistKey(keyId);
  return { keyId, status: "disabled" };
}

export function enableKey(keyId) {
  keyStatus[keyId] = "active";
  persistKey(keyId);
  return { keyId, status: "active" };
}

export function resetVendorMock() {
  for (const key of Object.keys(vendorUsageByKey)) delete vendorUsageByKey[key];
  for (const key of Object.keys(keyStatus)) delete keyStatus[key];
  keyStatus["gm-demo-key"] = "active";
  keyStatus["oa-demo-key"] = "active";
  keyStatus["oa-live-key"] = "active";
  keyStatus["tw-demo-key"] = "active";
}

export function hydrateVendorMock({ usage = {}, status = {} } = {}) {
  resetVendorMock();
  Object.assign(vendorUsageByKey, usage);
  Object.assign(keyStatus, {
    "gm-demo-key": "active",
    "oa-demo-key": "active",
    "oa-live-key": "active",
    "tw-demo-key": "active",
    ...status,
  });
}
