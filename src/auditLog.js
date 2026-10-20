/**
 * Audit log — who changed what (rules, kill switch, etc.).
 * Kept in memory for speed and saved to Postgres when DATABASE_URL is set.
 * Unlike normal staging state, audits should survive reset.
 */

import { appendEvent } from "./eventLog.js";
import { dbEnabled } from "./db/postgres.js";
import { wbAudit } from "./db/writeBehind.js";
import crypto from "node:crypto";
import { getTenantId } from "./tenant/context.js";

/** @type {object[]} */
const audits = [];
const MAX = 500;
const GENESIS = "bleedstop-audit-genesis";
let tip = GENESIS;

function canon(row) {
  return JSON.stringify({
    prev: row.prevHash,
    at: row.at,
    action: row.action,
    actor: row.actor,
    target: row.target,
    before: row.before,
    after: row.after,
    meta: row.meta,
    tenantId: row.tenantId,
  });
}

function sha(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

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
    tenantId: getTenantId(),
    prevHash: tip,
  };
  row.hash = sha(canon(row));
  tip = row.hash;
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

/** Oldest first, one JSON object per line. */
export function exportAuditJsonl() {
  const lines = [];
  for (let i = audits.length - 1; i >= 0; i--) lines.push(JSON.stringify(audits[i]));
  return lines.length ? `${lines.join("\n")}\n` : "";
}

/**
 * Check the rows still held in memory. Dropped rows (past the 500 cap) are not here.
 * A changed field breaks the hash. A swapped row breaks prevHash.
 */
export function verifyAuditChain() {
  let prev = null;
  let checked = 0;
  const problems = [];
  for (let i = audits.length - 1; i >= 0; i--) {
    const row = audits[i];
    if (!row.hash) continue;
    if (prev != null && row.prevHash !== prev) problems.push({ id: row.id, problem: "prev" });
    if (row.hash !== sha(canon(row))) problems.push({ id: row.id, problem: "hash" });
    prev = row.hash;
    checked++;
  }
  return { ok: problems.length === 0, checked, problems };
}

export function resetAudits() {
  audits.length = 0;
  tip = GENESIS;
}

export function hydrateAudits(rows = []) {
  audits.length = 0;
  audits.push(...rows.slice(0, MAX));
  tip = audits.find((r) => r.hash)?.hash || GENESIS;
}
