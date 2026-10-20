/**
 * MCP security gateway. Sits between an MCP client (agent) and MCP tool servers.
 * Every tools/call goes through: tool pin (rug pull) -> definition scan (tool poisoning) ->
 * Cedar policy (per tenant, per tool) -> agent guard on arguments (injection, exfiltration,
 * loops) -> /decide budget (action "mcp.tool_call", same cluster ceilings as everything else).
 * Tool results are scanned for indirect injection. Mode "shadow" logs and forwards; "enforce" blocks.
 * Upstreams: in process demo servers, or streamable HTTP MCP servers from MCP_UPSTREAMS
 * (JSON {"id":"https://host/mcp"}). The stdio transport lives in bin/mcp-gateway-stdio.js.
 */
import { scanToolDefinition } from "./toolScan.js";
import { checkPin } from "./pins.js";
import { authorizeToolCall } from "./cedarPolicy.js";
import { demoServers } from "./demoServers.js";
import { precheckAgentCall } from "../agentGuard.js";
import { precheckTwoStage } from "../classifierClient.js";
import { decide } from "../decision.js";
import { getPolicy } from "../policy.js";
import { inc, observe } from "../extraMetrics.js";
import { withSpan } from "../tracing.js";

const RANK = { ALLOW: 0, LIMIT: 1, CHALLENGE: 2, DENY: 3 };
const worst = (a, b) => (RANK[b] > RANK[a] ? b : a);
export const gatewayMode = () => (process.env.MCP_GATEWAY_MODE === "shadow" ? "shadow" : "enforce");

/** @type {Map<string, Map<string, {tool:any, scan:any, pin:any}>>} tenant|server -> tool name -> state */
const listed = new Map();
const auditTrail = [];
function audit(e) { auditTrail.push({ ts: new Date().toISOString(), ...e }); if (auditTrail.length > 500) auditTrail.shift(); }
export function recentMcpAudit(tenantId, n = 50) { return auditTrail.filter((e) => e.tenantId === tenantId).slice(-n); }
export function resetGateway() { listed.clear(); auditTrail.length = 0; }

function upstreams() {
  try { return JSON.parse(process.env.MCP_UPSTREAMS || "{}"); } catch { return {}; }
}

/** Forward one JSON-RPC message upstream; returns the JSON-RPC response (or null for notifications). */
const registered = new Map();
/** Register a custom upstream transport (used by the stdio gateway): { handle(msg) -> Promise<response|null> } */
export function registerUpstream(serverId, transport) { registered.set(serverId, transport); }

export async function forward(serverId, msg, { sessionId } = {}) {
  if (registered.has(serverId)) return registered.get(serverId).handle(msg);
  if (demoServers[serverId]) return demoServers[serverId].handle(msg);
  const url = upstreams()[serverId];
  if (!url) throw Object.assign(new Error(`Unknown MCP server ${serverId}`), { code: -32004 });
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}) },
    body: JSON.stringify(msg),
  });
  if (r.status === 202) return null;
  const ct = r.headers.get("content-type") || "";
  const text = await r.text();
  if (ct.includes("text/event-stream")) {
    for (const block of text.split(/\n\n/)) {
      const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
      if (data) { const m = JSON.parse(data); if (m.id === msg.id) return m; }
    }
    return null;
  }
  return text ? JSON.parse(text) : null;
}

function rpcError(id, code, message, data) { return { jsonrpc: "2.0", id, error: { code, message, data } }; }

async function onToolsList(tenantId, serverId, resp, mode) {
  const tools = resp?.result?.tools || [];
  const state = listed.get(`${tenantId}|${serverId}`) || new Map();
  const kept = [];
  const findings = [];
  for (const tool of tools) {
    const scan = scanToolDefinition(tool);
    const pin = checkPin(tenantId, serverId, tool);
    state.set(tool.name, { tool, scan, pin });
    const blocked = scan.poisoned || pin.status === "changed";
    if (scan.severity !== "none" || pin.status === "changed") {
      findings.push({ tool: tool.name, pin: pin.status, severity: scan.severity, reasons: scan.reasons });
      if (scan.poisoned) inc("bleedstop_mcp_tool_poisoned_total", "Tool definitions flagged as poisoned", { server: serverId, mode });
      if (pin.status === "changed") inc("bleedstop_mcp_rug_pull_total", "Tool definitions whose pinned hash changed", { server: serverId, mode });
      audit({ tenantId, server: serverId, event: "tools/list finding", tool: tool.name, pin: pin.status, severity: scan.severity, reasons: scan.reasons, mode });
    }
    if (!(blocked && mode === "enforce")) kept.push(tool);
  }
  listed.set(`${tenantId}|${serverId}`, state);
  return { ...resp, result: { ...resp.result, tools: kept, _meta: { ...(resp.result?._meta || {}), "bleedstop/findings": findings, "bleedstop/mode": mode } } };
}

/** Run the full decision for one tools/call. Returns { decision, reasons, stages }. */
export async function evaluateToolCall({ tenantId, serverId, name, args, sessionId, actorId }) {
  const stages = {};
  const reasons = [];
  let decision = "ALLOW";
  const st = listed.get(`${tenantId}|${serverId}`)?.get(name);
  if (!st) { decision = "DENY"; reasons.push("unlisted_tool: call tools/list first; unknown tools are not callable"); stages.pin = "unknown"; }
  else {
    stages.pin = st.pin.status;
    if (st.pin.status === "changed") { decision = "DENY"; reasons.push(`rug_pull: definition hash ${st.pin.hash.slice(0, 12)} != pinned ${st.pin.pinned.slice(0, 12)}`); }
    stages.scan = st.scan.severity;
    if (st.scan.poisoned) { decision = "DENY"; reasons.push(...st.scan.reasons); }
  }
  const cedar = authorizeToolCall({ tenantId, server: serverId, tool: name, args, internalDomains: (process.env.MCP_INTERNAL_DOMAINS || "acme.com,example.com").split(",") });
  stages.cedar = { decision: cedar.decision, policies: cedar.policyIds };
  if (cedar.decision !== "ALLOW") { decision = worst(decision, cedar.decision); reasons.push(`policy:${cedar.policyIds.join("+")}`); }
  const guard = await precheckTwoStage({ sessionId: sessionId || `${tenantId}:${actorId}`, toolName: name, toolArgs: args }, getPolicy());
  stages.guard = guard.verdict;
  if (guard.verdict === "block") { decision = worst(decision, "DENY"); reasons.push(...guard.reasons); }
  else if (guard.verdict === "flag") reasons.push(...guard.reasons.map((r) => `flag:${r}`));
  if (decision === "ALLOW") {
    const d = await decide({ actorId: actorId || `${tenantId}:mcp`, action: "mcp.tool_call", paid: false, signals: {} });
    stages.budget = { decision: d.decision, spendAfter: d.spendAfter, ceilingUsd: d.ceilingUsd };
    if (d.decision !== "ALLOW") { decision = worst(decision, d.decision === "LIMIT" ? "DENY" : d.decision); reasons.push(`budget:${d.reason}`); }
  }
  return { decision, reasons, stages };
}

/**
 * Handle one JSON-RPC message from the client for upstream `serverId`.
 * @returns {Promise<{ response: any, decision?: object }>}
 */
export async function handleMcpMessage({ tenantId, serverId, msg, sessionId, actorId, mode = gatewayMode() }) {
  return withSpan(msg?.method === "tools/call" ? `execute_tool ${msg?.params?.name}` : `mcp ${msg?.method}`, {
    "gen_ai.operation.name": msg?.method === "tools/call" ? "execute_tool" : "mcp",
    "gen_ai.tool.name": msg?.params?.name, "gen_ai.tool.call.id": msg?.id != null ? String(msg.id) : undefined,
    "mcp.server": serverId, "mcp.method.name": msg?.method, "bleedstop.tenant": tenantId, "bleedstop.mode": mode,
  }, async (span) => {
    const t0 = performance.now();
    if (msg?.method === "tools/list") {
      const resp = await forward(serverId, msg, { sessionId });
      return { response: resp?.result ? await onToolsList(tenantId, serverId, resp, mode) : resp };
    }
    if (msg?.method !== "tools/call") return { response: await forward(serverId, msg, { sessionId }) };
    const name = msg.params?.name, args = msg.params?.arguments ?? {};
    const ev = await evaluateToolCall({ tenantId, serverId, name, args, sessionId, actorId });
    span.setAttribute("bleedstop.decision", ev.decision);
    const overhead = performance.now() - t0;
    observe("bleedstop_mcp_gateway_overhead_ms", "Gateway decision time per tools/call (ms)", overhead, { mode });
    inc("bleedstop_mcp_tool_calls_total", "MCP tools/call by decision", { server: serverId, tool: name, decision: ev.decision, mode });
    audit({ tenantId, server: serverId, event: "tools/call", tool: name, decision: ev.decision, reasons: ev.reasons, mode, overheadMs: Math.round(overhead * 100) / 100 });
    if (ev.decision !== "ALLOW" && mode === "enforce") {
      return { response: rpcError(msg.id, ev.decision === "CHALLENGE" ? -32002 : -32001, ev.decision === "CHALLENGE" ? "BleedStop: human approval required" : "BleedStop: tool call denied", { decision: ev.decision, reasons: ev.reasons, stages: ev.stages }), decision: ev };
    }
    const resp = await forward(serverId, msg, { sessionId });
    // indirect injection: scan tool output before it reaches the model
    const outText = (resp?.result?.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
    const out = outText ? await precheckTwoStage({ text: outText }, getPolicy()) : { verdict: "allow", reasons: [] };
    if (out.verdict === "block") {
      inc("bleedstop_mcp_tool_result_injection_total", "Tool results carrying injected instructions", { server: serverId, mode });
      audit({ tenantId, server: serverId, event: "tool result injection", tool: name, reasons: out.reasons, mode });
      if (mode === "enforce") {
        return { response: { ...resp, result: { content: [{ type: "text", text: "[BleedStop removed this tool output: it contained instructions aimed at the AI model]" }], isError: true, _meta: { "bleedstop/result_reasons": out.reasons } } }, decision: { ...ev, decision: "DENY", reasons: [...ev.reasons, ...out.reasons.map((r) => `tool_result:${r}`)] } };
      }
    }
    return { response: resp?.result ? { ...resp, result: { ...resp.result, _meta: { ...(resp.result._meta || {}), "bleedstop/decision": ev.decision, "bleedstop/shadow_reasons": mode === "shadow" ? [...ev.reasons, ...out.reasons] : undefined } } } : resp, decision: ev };
  });
}

/** Scripted end to end scenarios for the live demo page (one request, deterministic, serverless safe). */
export async function runScenario(tenantId, scenario, mode = "enforce") {
  const steps = [];
  const sid = `demo-${Math.random().toString(36).slice(2, 10)}`;
  const server = { clean: "demo-clean", external_email: "demo-clean", poisoned: "demo-poisoned", rugpull: "demo-rugpull", indirect: "demo-indirect", shell: "demo-clean" }[scenario];
  if (!server) throw new Error("unknown scenario");
  // fresh pins per demo run so scenarios are repeatable: a unique virtual server id per session
  const sv = `${server}#${sid}`;
  const call = async (msg) => {
    const t0 = performance.now();
    const r = await handleMcpMessage({ tenantId, serverId: server, msg, sessionId: sid, actorId: sid, mode, _pinScope: sv });
    steps.push({ request: msg, response: r.response, decision: r.decision?.decision, ms: Math.round((performance.now() - t0) * 100) / 100 });
    return r;
  };
  const { resetPinsFor } = await import("./pins.js");
  resetPinsFor?.(tenantId, server);
  listed.delete(`${tenantId}|${server}`);
  const { demoServers: ds } = await import("./demoServers.js");
  ds[server].reset();
  await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "bleedstop-demo", version: "1" } } });
  await call({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  if (scenario === "clean") await call({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_weather", arguments: { city: "Lahore" } } });
  if (scenario === "external_email") await call({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "send_email", arguments: { to: "someone@gmail.com", subject: "Invoice", body: "Attached." } } });
  if (scenario === "shell") await call({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "run_shell", arguments: { cmd: "cat ~/.ssh/id_rsa" } } });
  if (scenario === "poisoned") await call({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "add", arguments: { a: 2, b: 3, sidenote: "" } } });
  if (scenario === "rugpull") {
    await call({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_fact_of_the_day", arguments: {} } });
    await call({ jsonrpc: "2.0", id: 4, method: "tools/list" });
    await call({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_fact_of_the_day", arguments: {} } });
  }
  if (scenario === "indirect") await call({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "fetch_page", arguments: { url: "https://shop.example/p/1" } } });
  const last = steps[steps.length - 1];
  const findings = steps.flatMap((s) => s.response?.result?._meta?.["bleedstop/findings"] || []);
  return { scenario, mode, server, steps, final: last.decision || (last.response?.error ? "DENY" : "ALLOW"), findings };
}
