/**
 * Audit log — who changed what (rules, kill switch, etc.).
 * Kept in memory for speed and saved to Postgres when DATABASE_URL is set.
 * Unlike normal staging state, audits should survive reset.
 */

import { appendEvent } from "./eventLog.js";
import { dbEnabled } from "./db/postgres.js";
import { wbAudit } from "./db/writeBehind.js";
import crypto from "node:crypto";

/** @type {object[]} */
const audits = [];
const MAX = 500;

export function recordAudit({
  action,
  actor = "system",
  target = null,
  before = null,
  after = null,
  meta = {},
} = {}) {
  const row = {
    id: `aud-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
    at: new Date().toISOString(),
    action,
    actor,
    target,
    before,
    after,
    meta,
  };
  audits.unshift(row);
  if (audits.length > MAX) audits.length = MAX;

  if (dbEnabled()) {
    wbAudit(row);
  }

  appendEvent({
    type: "audit",
    action,
    actor,
    target,
    before,
    after,
    meta,
  });

  return row;
}

export function listAudits({ limit = 50 } = {}) {
  return audits.slice(0, limit);
}

export function resetAudits() {
  audits.length = 0;
}

export function hydrateAudits(rows = []) {
  audits.length = 0;
  audits.push(...rows.slice(0, MAX));
}
