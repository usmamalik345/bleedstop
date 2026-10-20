/**
 * Identity clustering (Union-Find).
 * Graph is cached in memory and saved to Postgres when DATABASE_URL is set.
 */

import { dbEnabled } from "./db/postgres.js";
import { wbActor, wbSignal, wbLabel, wbMeta } from "./db/writeBehind.js";

/** @type {Record<string, string>} */
const parent = {};
/** @type {Record<string, string>} */
const signalOwner = {};
let clusterSeq = 1;
/** @type {Record<string, string>} */
const clusterName = {};

// Incremental persistence: only changed rows are written (was: full graph rewrite per call)
function setParent(a, p) { parent[a] = p; if (dbEnabled()) wbActor(a, p); }
function setLabel(root, id) { if (id == null) delete clusterName[root]; else clusterName[root] = id; if (dbEnabled()) wbLabel(root, id ?? null); }
function setSignal(key, owner) { signalOwner[key] = owner; if (dbEnabled()) wbSignal(key, owner); }

function ensureActor(actorId) {
  if (!parent[actorId]) {
    setParent(actorId, actorId);
  }
}

function find(actorId) {
  ensureActor(actorId);
  if (parent[actorId] !== actorId) {
    const root = find(parent[actorId]);
    if (parent[actorId] !== root) setParent(actorId, root);
  }
  return parent[actorId];
}

function union(a, b) {
  const rootA = find(a);
  const rootB = find(b);
  if (rootA === rootB) return rootA;
  setParent(rootB, rootA);
  if (!clusterName[rootA] && clusterName[rootB]) {
    setLabel(rootA, clusterName[rootB]);
  }
  if (clusterName[rootB] != null) setLabel(rootB, null);
  return rootA;
}

export function normalizeEmail(email) {
  if (!email) return null;
  const trimmed = String(email).trim().toLowerCase();
  const [local, domain] = trimmed.split("@");
  if (!local || !domain) return trimmed;
  let cleanLocal = local.split("+")[0];
  if (domain === "gmail.com" || domain === "googlemail.com") {
    cleanLocal = cleanLocal.replace(/\./g, "");
  }
  return `${cleanLocal}@${domain}`;
}

export function toSignalKeys({ deviceFingerprint, email, asn }) {
  const keys = [];
  if (deviceFingerprint) keys.push(`device:${deviceFingerprint}`);
  const normEmail = normalizeEmail(email);
  if (normEmail) keys.push(`email:${normEmail}`);
  // ASN is an ISP, not a person: unioning on it merges every customer of that ISP into
  // one budget (shared-NAT false positives). Off by default; ASN is used as a *velocity*
  // signal instead (network.js, R-asn-spread). CLUSTER_ON_ASN=1 restores legacy behaviour.
  if (asn && process.env.CLUSTER_ON_ASN === "1") keys.push(`asn:${asn}`);
  return keys;
}

export function resolveCluster(actorId, signals = {}) {
  ensureActor(actorId);

  for (const key of toSignalKeys(signals)) {
    const owner = signalOwner[key];
    if (owner) {
      union(actorId, owner);
    } else {
      setSignal(key, actorId);
    }
  }

  const root = find(actorId);
  if (!clusterName[root]) {
    setLabel(root, `C-${clusterSeq++}`);
    if (dbEnabled()) wbMeta("cluster_seq", clusterSeq);
  }
  return clusterName[root];
}

export function listClusters() {
  /** @type {Record<string, string[]>} */
  const byCluster = {};
  for (const actorId of Object.keys(parent)) {
    const root = find(actorId);
    const id = clusterName[root] ?? root;
    if (!byCluster[id]) byCluster[id] = [];
    byCluster[id].push(actorId);
  }
  return byCluster;
}

export function resetClusters() {
  for (const key of Object.keys(parent)) delete parent[key];
  for (const key of Object.keys(signalOwner)) delete signalOwner[key];
  for (const key of Object.keys(clusterName)) delete clusterName[key];
  clusterSeq = 1;
}

export function hydrateClusters({
  parentMap = {},
  signalOwnerMap = {},
  clusterNameMap = {},
  seq = 1,
} = {}) {
  resetClusters();
  Object.assign(parent, parentMap);
  Object.assign(signalOwner, signalOwnerMap);
  Object.assign(clusterName, clusterNameMap);
  clusterSeq = seq || 1;
}
