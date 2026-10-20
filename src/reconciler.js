/**
 * Ghost-spend reconciler: vendorBill - appBill ≥ threshold → kill key.
 */

import { config } from "./config.js";
import { roundMoney } from "./utils/money.js";
import { getAppKeySpend, listAppKeySpend } from "./keyLedger.js";
import {
  disableKey,
  getKeyStatus,
  getVendorUsage,
  listVendorUsage,
} from "./vendorMock.js";
import { recordIncident } from "./incidents.js";
import { appendEvent } from "./eventLog.js";
import { notifySlack, ghostSpendSlackText } from "./notify/slack.js";
import { getTenantId } from "./tenant/context.js";
import { incReconcile } from "./metrics.js";

export const GHOST_THRESHOLD_USD = config.ghostThresholdUsd;

export function reconcile({ keyId, autoKill = true } = {}) {
  const keyIds = keyId
    ? [keyId]
    : Array.from(
        new Set([...Object.keys(listAppKeySpend()), ...Object.keys(listVendorUsage())])
      );

  const results = [];

  for (const id of keyIds) {
    const appSpend = getAppKeySpend(id);
    const vendorSpend = getVendorUsage(id);
    const ghostSpend = roundMoney(vendorSpend - appSpend);
    const status = getKeyStatus(id);
    const hit = ghostSpend >= GHOST_THRESHOLD_USD;
    let action = "none";
    let incident = null;

    if (hit && autoKill && status === "active") {
      disableKey(id);
      action = "kill_switch_disabled_key";
      incident = recordIncident({
        type: "ghost_spend",
        severity: "high",
        keyId: id,
        appSpend,
        vendorSpend,
        ghostSpend,
        action,
        dollarsLostEst: ghostSpend,
        dollarsExposureEst: ghostSpend,
        rootCause: "Vendor usage exceeded app ledger — likely leaked/unrestricted API key.",
        message: `Ghost spend $${ghostSpend.toFixed(3)} on key ${id}. Key disabled.`,
      });
      appendEvent({
        type: "reconcile",
        keyId: id,
        ghostSpend,
        action,
        incidentId: incident.id,
      });
      // Off hot path: Slack alert (no await — reconcile stays sync for callers)
      void notifySlack(
        ghostSpendSlackText({
          keyId: id,
          ghostSpend,
          appSpend,
          vendorSpend,
          tenantId: getTenantId(),
          incidentId: incident.id,
        })
      );
    } else if (hit && status === "disabled") {
      action = "already_disabled";
    }

    results.push({
      keyId: id,
      appSpend,
      vendorSpend,
      ghostSpend,
      threshold: GHOST_THRESHOLD_USD,
      ghostDetected: hit,
      keyStatus: getKeyStatus(id),
      action,
      incidentId: incident?.id ?? null,
    });
  }

  const ghosts = results.filter((r) => r.ghostDetected).length;
  incReconcile({ ghosts });
  return { checkedAt: new Date().toISOString(), results };
}
