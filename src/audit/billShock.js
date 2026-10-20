/**
 * Read-only Bill-Shock Audit (PDF week 12).
 * No SDK install: look at app ledger vs vendor bill and say the night's exposure.
 */

import { listSpend } from "../ledger.js";
import { listAppKeySpend } from "../keyLedger.js";
import { listVendorUsage, listKeyStatus } from "../vendorMock.js";
import { listIncidents } from "../incidents.js";
import { UNPAID_CEILING_USD, PAID_CEILING_USD } from "../ledger.js";
import { roundMoney } from "../utils/money.js";

export function billShockAudit() {
  const clusters = listSpend();
  const app = listAppKeySpend();
  const vendor = listVendorUsage();
  const keys = listKeyStatus();

  const keyIds = new Set([...Object.keys(app), ...Object.keys(vendor)]);
  const ghosts = [];
  for (const keyId of keyIds) {
    const appBill = app[keyId] || 0;
    const vendorBill = vendor[keyId] || 0;
    const gap = roundMoney(vendorBill - appBill);
    if (gap > 0) {
      ghosts.push({ keyId, appBill, vendorBill, ghostSpend: gap, status: keys[keyId] || "unknown" });
    }
  }

  const clusterRows = Object.entries(clusters).map(([id, spend]) => ({
    clusterId: id,
    spend,
    overUnpaidCeiling: spend > UNPAID_CEILING_USD,
  }));

  const ghostTotal = roundMoney(ghosts.reduce((s, g) => s + g.ghostSpend, 0));
  const clusterTotal = roundMoney(clusterRows.reduce((s, c) => s + c.spend, 0));

  return {
    kind: "bill-shock-audit",
    readOnly: true,
    ceilings: { unpaid: UNPAID_CEILING_USD, paid: PAID_CEILING_USD },
    clusterSpendUsd: clusterTotal,
    ghostSpendUsd: ghostTotal,
    exposureUsd: roundMoney(clusterTotal + ghostTotal),
    clusters: clusterRows,
    ghosts,
    incidents: listIncidents().slice(0, 10),
    headline:
      ghostTotal > 0
        ? `Ghost spend $${ghostTotal} on vendor bills that did not pass through the app.`
        : `No ghost gap. Cluster bills total $${clusterTotal}.`,
  };
}
