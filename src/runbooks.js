/**
 * Kill-switch runbooks the owner pre-approves.
 * Every action is logged and can be undone.
 */

import { disableKey, enableKey } from "./vendorMock.js";
import { recordAudit } from "./auditLog.js";

/** @type {Set<string>} clusters that cannot send OTP/SMS */
const otpFrozen = new Set();

export function isOtpFrozen(clusterId) {
  return otpFrozen.has(clusterId);
}

export function freezeOtp(clusterId, { actor = "operator" } = {}) {
  if (!clusterId) throw new Error("clusterId required");
  otpFrozen.add(clusterId);
  recordAudit({
    action: "runbook.otp_freeze",
    actor,
    target: clusterId,
    before: "open",
    after: "frozen",
  });
  return { ok: true, clusterId, otp: "frozen", reversible: true };
}

export function unfreezeOtp(clusterId, { actor = "operator" } = {}) {
  otpFrozen.delete(clusterId);
  recordAudit({
    action: "runbook.otp_unfreeze",
    actor,
    target: clusterId,
    before: "frozen",
    after: "open",
  });
  return { ok: true, clusterId, otp: "open" };
}

export function disableVendorKey(keyId, { actor = "operator" } = {}) {
  const result = disableKey(keyId);
  recordAudit({
    action: "runbook.disable_key",
    actor,
    target: keyId,
    after: "disabled",
  });
  return { ...result, reversible: true };
}

export function enableVendorKey(keyId, { actor = "operator" } = {}) {
  const result = enableKey(keyId);
  recordAudit({
    action: "runbook.enable_key",
    actor,
    target: keyId,
    after: "active",
  });
  return result;
}

export function listRunbooks() {
  return {
    otpFrozenClusters: [...otpFrozen],
    actions: [
      "otp_freeze",
      "otp_unfreeze",
      "disable_key",
      "enable_key",
    ],
  };
}

export function resetRunbooks() {
  otpFrozen.clear();
}
