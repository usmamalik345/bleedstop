/**
 * On boot: pull real rows from Postgres into memory caches.
 * Then the API stays fast, but restarts keep your data.
 */

import { dbEnabled, dbReady } from "./postgres.js";
import { loadAllState, recordTenantPolicies } from "./repository.js";
import { describePolicy, getPolicy } from "../policy.js";
import { getTenantId } from "../tenant/context.js";
import crypto from "node:crypto";
import { hydrateLedger } from "../ledger.js";
import { hydrateKeyLedger } from "../keyLedger.js";
import { hydrateVendorMock } from "../vendorMock.js";
import { hydrateIncidents } from "../incidents.js";
import { hydrateEvents } from "../eventLog.js";
import { hydrateClusters } from "../cluster.js";
import { hydrateAudits } from "../auditLog.js";

export async function hydrateFromDatabase() {
  if (!dbEnabled()) {
    return { mode: "memory", loaded: false };
  }

  await dbReady();
  // durable tenants + versioned policy snapshots (one row per distinct effective policy)
  const desc = describePolicy();
  const ids = [...new Set([getTenantId(), ...desc.tenants])];
  await recordTenantPolicies(ids.map((tenantId) => {
    const policy = getPolicy(tenantId);
    const sha256 = crypto.createHash("sha256").update(JSON.stringify(policy, Object.keys(policy).sort())).digest("hex");
    return { tenantId, policy, sha256, source: desc.source };
  }));
  const state = await loadAllState();
  if (!state) return { mode: "memory", loaded: false };

  hydrateLedger({
    spend: state.spendByCluster,
    reservationsMap: state.reservations,
  });
  hydrateKeyLedger(state.appSpendByKey);
  hydrateVendorMock({
    usage: state.vendorUsageByKey,
    status: state.keyStatus,
  });
  hydrateIncidents(state.incidents);
  hydrateEvents(state.events);
  hydrateAudits(state.audits || []);
  hydrateClusters({
    parentMap: state.parent,
    signalOwnerMap: state.signalOwner,
    clusterNameMap: state.clusterName,
    seq: state.clusterSeq,
  });

  return {
    mode: "postgres",
    loaded: true,
    counts: {
      clusters: Object.keys(state.spendByCluster).length,
      appKeys: Object.keys(state.appSpendByKey).length,
      vendorKeys: Object.keys(state.vendorUsageByKey).length,
      incidents: state.incidents.length,
      events: state.events.length,
      audits: (state.audits || []).length,
      actors: Object.keys(state.parent).length,
    },
  };
}
