/**
 * Per-tenant policy (budgets, caps, signal thresholds).
 *
 * Source order (later wins): built-in defaults ← env (config.js) ← POLICY_FILE YAML
 *   defaults:   { ...keys }
 *   tenants:    { tenant-acme: { unpaidCeilingUsd: 20, ... } }
 *
 * Every value is validated at load; an invalid file fails boot loudly instead of
 * silently running with a wrong ceiling (ADR-0006).
 */
import fs from "node:fs";
import YAML from "yaml";
import { config } from "./config.js";
import { getTenantId } from "./tenant/context.js";

/** name → [type, min, max] */
export const POLICY_SCHEMA = {
  unpaidCeilingUsd: ["number", 0, 1e6],
  paidCeilingUsd: ["number", 0, 1e7],
  llmUsdPer1kTokens: ["number", 0, 100],
  llmMaxTokensUnpaid: ["int", 1, 10_000_000],
  llmVelocityMaxPerMin: ["int", 1, 1_000_000],
  subnetPoolMinActors: ["int", 2, 1_000_000],
  subnetPoolCeilingUsd: ["number", 0, 1e6],
  subnetPoolPerActorUsd: ["number", 0, 1e4],
  asnSpreadMaxSubnets: ["int", 2, 1_000_000],
  asnSpreadMode: ["enum", ["off", "shadow", "enforce"]],
  agentGuardMode: ["enum", ["off", "shadow", "enforce"]],
  agentMaxToolCallsPerMin: ["int", 1, 1_000_000],
  agentMaxDepth: ["int", 1, 100],
  decideRatePerSec: ["number", 0, 1e6],
  decideBurst: ["int", 1, 1e7],
};

function envDefaults() {
  return {
    unpaidCeilingUsd: config.unpaidCeilingUsd,
    paidCeilingUsd: config.paidCeilingUsd,
    llmUsdPer1kTokens: config.llmUsdPer1kTokens,
    llmMaxTokensUnpaid: config.llmMaxTokensUnpaid,
    llmVelocityMaxPerMin: config.llmVelocityMaxPerMin,
    subnetPoolMinActors: Number(process.env.SUBNET_POOL_MIN_ACTORS || 10),
    subnetPoolCeilingUsd: Number(process.env.SUBNET_POOL_CEILING_USD || 5),
    subnetPoolPerActorUsd: Number(process.env.SUBNET_POOL_PER_ACTOR_USD || 0.1),
    asnSpreadMaxSubnets: Number(process.env.ASN_SPREAD_MAX_SUBNETS || 20),
    asnSpreadMode: process.env.ASN_SPREAD_MODE || "shadow",
    agentGuardMode: process.env.AGENT_GUARD_MODE || "enforce",
    agentMaxToolCallsPerMin: Number(process.env.AGENT_MAX_TOOL_CALLS_PER_MIN || 30),
    agentMaxDepth: Number(process.env.AGENT_MAX_DEPTH || 5),
    decideRatePerSec: Number(process.env.DECIDE_RATE_PER_SEC || 2000),
    decideBurst: Number(process.env.DECIDE_BURST || 4000),
  };
}

export function validatePolicy(obj, where = "policy") {
  const errors = [];
  if (obj == null || typeof obj !== "object" || Array.isArray(obj)) {
    return [`${where}: must be a mapping`];
  }
  for (const [k, v] of Object.entries(obj)) {
    const rule = POLICY_SCHEMA[k];
    if (!rule) { errors.push(`${where}.${k}: unknown key`); continue; }
    const [type, a, b] = rule;
    if (type === "enum") {
      if (!a.includes(v)) errors.push(`${where}.${k}: must be one of ${a.join("|")}`);
      continue;
    }
    if (typeof v !== "number" || !Number.isFinite(v)) { errors.push(`${where}.${k}: must be a number`); continue; }
    if (type === "int" && !Number.isInteger(v)) errors.push(`${where}.${k}: must be an integer`);
    if (v < a || v > b) errors.push(`${where}.${k}: out of range [${a}, ${b}]`);
  }
  return errors;
}

let defaults = envDefaults();
/** @type {Record<string, object>} */
let tenants = {};
let source = "env";

/** Parse + validate a YAML string. Throws with every error listed. */
export function loadPolicyText(text, label = "inline") {
  const doc = YAML.parse(text) || {};
  const errors = [];
  for (const k of Object.keys(doc)) if (!["defaults", "tenants"].includes(k)) errors.push(`${k}: unknown top-level key`);
  const base = envDefaults();
  errors.push(...validatePolicy(base, "env"));
  if (doc.defaults) errors.push(...validatePolicy(doc.defaults, "defaults"));
  const t = doc.tenants || {};
  if (typeof t !== "object" || Array.isArray(t)) errors.push("tenants: must be a mapping");
  else for (const [id, p] of Object.entries(t)) {
    if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(id)) errors.push(`tenants.${id}: invalid tenant id`);
    errors.push(...validatePolicy(p, `tenants.${id}`));
  }
  if (errors.length) throw new Error(`Invalid policy (${label}):\n  ${errors.join("\n  ")}`);
  defaults = { ...base, ...(doc.defaults || {}) };
  tenants = { ...t };
  source = label;
  return describePolicy();
}

export function loadPolicyFromEnv() {
  const file = process.env.POLICY_FILE;
  defaults = envDefaults();
  tenants = {};
  source = "env";
  const envErrors = validatePolicy(defaults, "env");
  if (envErrors.length) throw new Error(`Invalid env policy:\n  ${envErrors.join("\n  ")}`);
  if (file) return loadPolicyText(fs.readFileSync(file, "utf8"), file);
  return describePolicy();
}

/** Effective policy for the current (or given) tenant. */
export function getPolicy(tenantId = getTenantId()) {
  const t = tenants[tenantId];
  return t ? { ...defaults, ...t } : defaults;
}

export function describePolicy() {
  return { source, defaults: { ...defaults }, tenants: Object.keys(tenants) };
}

loadPolicyFromEnv();
