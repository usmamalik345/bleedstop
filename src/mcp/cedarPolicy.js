/**
 * Per tenant, per tool policy as code with Cedar (cedar-policy/cedar-wasm).
 * Request: principal Tenant::"<id>", action Action::"call_tool", resource Tool::"<server>/<tool>",
 * context { server, tool, args, argText, recipientDomains, urlHosts, externalRecipient, amountUsd }.
 * Effects: no permit -> DENY (default deny); a matching `forbid` -> DENY, unless that forbid carries
 * @effect("challenge"), which maps to CHALLENGE (human approval). Policies carry @id("...").
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cedar from "@cedar-policy/cedar-wasm/nodejs";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = path.join(here, "..", "..", "config", "mcp-policy.cedar");

let loaded = null; // { text, policies: Record<id,text>, effects: Record<id,"deny"|"challenge"> }

export function loadCedarPolicies(text) {
  const parts = cedar.policySetTextToParts(text);
  if (parts.type !== "success") throw new Error(`Cedar parse failed: ${JSON.stringify(parts.errors).slice(0, 400)}`);
  const policies = {}, effects = {};
  parts.policies.forEach((p, i) => {
    const id = /@id\(\s*"([^"]+)"\s*\)/.exec(p)?.[1] || `policy${i}`;
    policies[id] = p;
    effects[id] = /@effect\(\s*"challenge"\s*\)/.test(p) ? "challenge" : /^\s*(@[^\n]*\n\s*)*forbid/m.test(p) ? "deny" : "permit";
  });
  const chk = cedar.checkParsePolicySet({ staticPolicies: policies });
  if (chk.type !== "success") throw new Error(`Cedar check failed: ${JSON.stringify(chk.errors).slice(0, 400)}`);
  loaded = { text, policies, effects };
  return { count: Object.keys(policies).length, ids: Object.keys(policies) };
}

function ensure() {
  if (loaded) return loaded;
  const f = process.env.MCP_POLICY_FILE || DEFAULT_FILE;
  loadCedarPolicies(fs.readFileSync(f, "utf8"));
  return loaded;
}

const URL_RE = /https?:\/\/([^/\s"'?#:]+)/gi;
const EMAIL_RE = /[a-z0-9._%+-]+@([a-z0-9.-]+\.[a-z]{2,})/gi;

export function buildContext(server, tool, args, { internalDomains = [] } = {}) {
  const argText = JSON.stringify(args ?? {}).slice(0, 20_000);
  const urlHosts = [...new Set([...argText.matchAll(URL_RE)].map((m) => m[1].toLowerCase()))];
  const recipientDomains = [...new Set([...argText.matchAll(EMAIL_RE)].map((m) => m[1].toLowerCase()))];
  const internal = new Set(internalDomains.map((d) => d.toLowerCase()));
  const externalRecipient = recipientDomains.some((d) => !internal.has(d));
  const amount = Number(args?.amount ?? args?.amountUsd ?? 0);
  return { server, tool, argText, urlHosts, recipientDomains, externalRecipient, amountCents: Number.isFinite(amount) ? Math.round(amount * 100) : 0 };
}

/** @returns {{ decision: "ALLOW"|"DENY"|"CHALLENGE", policyIds: string[], errors: string[] }} */
export function authorizeToolCall({ tenantId, server, tool, args, internalDomains }) {
  const p = ensure();
  const context = buildContext(server, tool, args, { internalDomains });
  const ans = cedar.isAuthorized({
    principal: { type: "Tenant", id: String(tenantId) },
    action: { type: "Action", id: "call_tool" },
    resource: { type: "Tool", id: `${server}/${tool}` },
    context,
    policies: { staticPolicies: p.policies },
    entities: [],
  });
  if (ans.type !== "success") return { decision: "DENY", policyIds: [], errors: ans.errors.map((e) => e.message || String(e)), context };
  const ids = ans.response.diagnostics.reason;
  const errors = ans.response.diagnostics.errors.map((e) => e.error?.message || JSON.stringify(e));
  if (ans.response.decision === "allow") return { decision: "ALLOW", policyIds: ids, errors, context };
  const challengeOnly = ids.length > 0 && ids.every((id) => p.effects[id] === "challenge");
  return { decision: challengeOnly ? "CHALLENGE" : "DENY", policyIds: ids.length ? ids : ["default_deny"], errors, context };
}

export function cedarPolicyText() { return ensure().text; }
export function resetCedar() { loaded = null; }
