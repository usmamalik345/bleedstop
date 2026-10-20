/**
 * Event log = history of decisions and spends.
 * Saved to Postgres when DATABASE_URL is set.
 */

import { roundMoney } from "./utils/money.js";
import { dbEnabled } from "./db/postgres.js";
import { wbEvent, wbLedger } from "./db/writeBehind.js";
import crypto from "node:crypto";

/** Per process prefix: event ids must not collide across replicas sharing one Postgres. */
const INSTANCE = crypto.randomBytes(3).toString("hex");

/** @type {object[]} */
const events = [];
const MAX = 5000;
let seq = 1;

export function appendEvent(event) {
  const row = {
    id: event.id || `evt-${Date.now()}-${INSTANCE}-${seq++}`,
    at: event.at || new Date().toISOString(),
    ...event,
  };
  events.push(row);
  if (events.length > MAX) events.shift();
  if (dbEnabled()) {
    wbEvent(row);
    // durable budget ledger: one append only row per charged decision
    if (row.type === "decision" && Number(row.actualCost) > 0 && (row.decision === "ALLOW" || row.decision === "LIMIT")) {
      wbLedger({ event_id: row.id, cluster_id: row.clusterId, actor_id: row.actorId ?? null, action: row.action, decision: row.decision, amount_usd: Number(row.actualCost), paid: Boolean(row.paid), at: row.at });
    }
  }
  return row;
}

export function listEvents({ limit = 100, type } = {}) {
  let rows = events;
  if (type) rows = rows.filter((e) => e.type === type);
  return rows.slice(-limit).reverse();
}

export function allEvents() {
  return [...events];
}

export function resetEvents() {
  events.length = 0;
  seq = 1;
}

export function hydrateEvents(rows = []) {
  resetEvents();
  for (const row of rows) events.push(row);
  seq = events.length + 1;
}

export function clusterSpendFromEvents(clusterId) {
  return roundMoney(
    events
      .filter(
        (e) =>
          e.clusterId === clusterId &&
          (e.type === "spend_commit" || e.type === "decision") &&
          (e.decision === "ALLOW" || e.decision === "LIMIT") &&
          typeof e.actualCost === "number"
      )
      .reduce((sum, e) => sum + e.actualCost, 0)
  );
}
