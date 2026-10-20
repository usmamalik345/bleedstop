/**
 * OpenAI compatible proxy: point an OpenAI SDK at BleedStop (`base_url = https://<bleedstop>/v1`,
 * api_key = your BleedStop key). For each request:
 *  1. /decide with mode "reserve" on the worst case cost (prompt tokens + max output tokens);
 *     DENY / CHALLENGE return an OpenAI style error, LIMIT downgrades to the small model.
 *  2. The output cap is min(requested, tenant cap, what is left of the budget) and is enforced
 *     MID STREAM: once the streamed text passes the cap, the upstream is aborted and the client gets
 *     finish_reason "length" plus [DONE].
 *  3. Usage reconciliation: the reservation is committed with the actual cost from the upstream
 *     `usage` block (stream_options.include_usage is forced on), or from the counted stream.
 *  4. tool_calls in the response are inspected with the MCP gateway policy (Cedar + agent guard);
 *     in enforce mode denied calls are removed and listed under `bleedstop.blocked_tool_calls`.
 * Upstream: OPENAI_PROXY_UPSTREAM (e.g. https://api.openai.com/v1, key from OPENAI_API_KEY on the
 * server, never from the client) or the built in deterministic mock (default; no network, no cost).
 */
import crypto from "node:crypto";
import { decide } from "../decision.js";
import { getPolicy } from "../policy.js";
import { authorizeToolCall } from "../mcp/cedarPolicy.js";
import { precheckAgentCall } from "../agentGuard.js";
import { inc, observe } from "../extraMetrics.js";
import { tracer } from "../tracing.js";
import { mockChat, mockResponses, promptText } from "./mockUpstream.js";

const approxTokens = (s) => Math.ceil(String(s || "").length / 4);
const upstreamUrl = () => process.env.OPENAI_PROXY_UPSTREAM || "mock";
const smallModel = () => process.env.OPENAI_PROXY_SMALL_MODEL || "gpt-4o-mini";
const maxOut = (paid) => Number(paid ? process.env.OPENAI_PROXY_MAX_OUTPUT_TOKENS_PAID || 16384 : process.env.OPENAI_PROXY_MAX_OUTPUT_TOKENS || 1024);
const usd = (tokens) => (tokens / 1000) * getPolicy().llmUsdPer1kTokens;
const oaiError = (res, status, message, code, extra) => res.status(status).json({ error: { message, type: "bleedstop_policy", code, param: null }, bleedstop: extra });

async function upstream(kind, body, signal) {
  const base = upstreamUrl();
  if (base === "mock") return kind === "chat" ? mockChat(body) : mockResponses(body);
  const r = await fetch(`${base.replace(/\/$/, "")}/${kind === "chat" ? "chat/completions" : "responses"}`, {
    method: "POST", signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY || ""}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) return { error: { status: r.status, body: await r.text() } };
  if (!body.stream) return { json: await r.json() };
  async function* sse() {
    const dec = new TextDecoder(); let buf = "";
    for await (const chunk of r.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
        if (!data || data === "[DONE]") continue;
        yield JSON.parse(data);
      }
    }
  }
  return { stream: sse() };
}

function inspectToolCalls(tenantId, toolCalls, sessionId) {
  const blocked = [], allowed = [];
  for (const tc of toolCalls || []) {
    let args = {}; try { args = JSON.parse(tc.function?.arguments || "{}"); } catch { args = { _raw: tc.function?.arguments }; }
    const name = tc.function?.name;
    const pol = authorizeToolCall({ tenantId, server: "llm", tool: name, args, internalDomains: (process.env.MCP_INTERNAL_DOMAINS || "acme.com,example.com").split(",") });
    const g = precheckAgentCall({ sessionId, toolName: name, toolArgs: args }, getPolicy());
    // the "llm" pseudo server has no permit by default; only explicit forbids / approvals count here
    const policyHit = pol.decision !== "ALLOW" && !pol.policyIds.includes("default_deny") ? pol.decision : "ALLOW";
    const decision = g.verdict === "block" ? "DENY" : policyHit;
    (decision === "ALLOW" ? allowed : blocked).push({ id: tc.id, name, decision, reasons: [...(decision !== "ALLOW" && pol.policyIds[0] !== "default_deny" ? pol.policyIds.map((p) => `policy:${p}`) : []), ...g.reasons] });
  }
  return { blocked, allowed };
}

/** Express handler factory for "chat" (/v1/chat/completions) and "responses" (/v1/responses). */
export function openaiHandler(kind) {
  return async (req, res) => {
    const t0 = performance.now();
    const tenantId = req.tenantId || process.env.TENANT_ID || "local-dev";
    const body = { ...(req.body || {}) };
    const enforce = process.env.OPENAI_PROXY_MODE !== "shadow";
    const paid = req.get("x-bleedstop-paid") === "true";
    const actorId = String(req.get("x-actor-id") || body.user || `${tenantId}:openai`).slice(0, 200).replace(/[^A-Za-z0-9_.@:+\-/]/g, "_");
    const messages = kind === "chat" ? body.messages : typeof body.input === "string" ? [{ role: "user", content: body.input }] : body.input;
    if (!Array.isArray(messages) || !messages.length) return oaiError(res, 400, kind === "chat" ? "messages is required" : "input is required", "invalid_request");
    const promptTokens = approxTokens(promptText(messages));
    const requested = Number(body.max_tokens ?? body.max_completion_tokens ?? body.max_output_tokens ?? maxOut(paid));
    let outCap = Math.min(requested, maxOut(paid));
    const key = `oai-${crypto.randomUUID()}`;
    const span = tracer().startSpan(`chat ${body.model || "unknown"}`, { attributes: {
      "gen_ai.operation.name": "chat", "gen_ai.provider.name": upstreamUrl() === "mock" ? "bleedstop.mock" : "openai",
      "gen_ai.request.model": body.model, "gen_ai.request.max_tokens": outCap, "gen_ai.conversation.id": req.get("x-conversation-id") || undefined,
      "bleedstop.tenant": tenantId, "bleedstop.actor": actorId, "bleedstop.proxy.api": kind } });
    const finish = (attrs) => { span.setAttributes(attrs); span.end(); };

    const d = await decide({ actorId, action: "llm.call", paid, estimatedTokens: promptTokens + outCap, mode: "reserve", idempotencyKey: key, signals: {} });
    span.setAttribute("bleedstop.decision", d.decision);
    inc("bleedstop_llm_proxy_requests_total", "OpenAI compatible proxy requests by decision", { api: kind, decision: d.decision });
    if (d.decision === "DENY" || d.decision === "CHALLENGE") {
      finish({ "bleedstop.reason": d.reason });
      return oaiError(res, d.decision === "DENY" ? 429 : 403, `BleedStop ${d.decision}: ${d.reason}`, d.decision === "DENY" ? "bleedstop_denied" : "bleedstop_challenge", { decision: d.decision, reason: d.reason, matchedRules: d.matchedRules });
    }
    if (d.decision === "LIMIT") { body.model = smallModel(); outCap = Math.min(outCap, 256); }
    // what is left of the budget caps the output too (reservation already holds the worst case)
    const ceiling = d.ceilingUsd ?? (paid ? 50 : 5);
    const left = Math.max(0, ceiling - (d.spendBefore ?? 0) - usd(promptTokens));
    const budgetTokens = Math.floor((left / getPolicy().llmUsdPer1kTokens) * 1000);
    outCap = Math.max(1, Math.min(outCap, budgetTokens));
    if (kind === "chat") { body.max_tokens = outCap; delete body.max_completion_tokens; } else body.max_output_tokens = outCap;
    if (body.stream && kind === "chat") body.stream_options = { ...(body.stream_options || {}), include_usage: true };

    const commit = async (inTok, outTok, cut) => {
      const actual = usd(inTok + outTok);
      await decide({ actorId, action: "llm.call", mode: "commit", idempotencyKey: key, actualCost: actual });
      inc("bleedstop_llm_tokens_total", "Tokens through the proxy", { type: "input" }, inTok);
      inc("bleedstop_llm_tokens_total", "Tokens through the proxy", { type: "output" }, outTok);
      inc("bleedstop_llm_cost_usd_total", "Reconciled USD through the proxy", { tenant: tenantId }, actual);
      if (cut) inc("bleedstop_llm_stream_cut_total", "Streams cut mid flight at the token cap", { api: kind });
      observe("bleedstop_llm_proxy_overhead_ms", "Proxy time before the first upstream byte (ms)", tFirst - t0, { api: kind });
      finish({ "gen_ai.response.model": body.model, "gen_ai.usage.input_tokens": inTok, "gen_ai.usage.output_tokens": outTok, "bleedstop.reconciled_usd": actual, "bleedstop.stream_cut": Boolean(cut) });
      return { reservedUsd: d.estimatedCost, actualUsd: Math.round(actual * 1e6) / 1e6, cut: Boolean(cut) };
    };
    const ctrl = new AbortController();
    let tFirst = performance.now();
    let up;
    try { up = await upstream(kind, body, ctrl.signal); } catch (err) { await commit(0, 0); return oaiError(res, 502, `upstream error: ${err.message}`, "upstream_error"); }
    tFirst = performance.now();
    if (up.error) { await commit(0, 0); return res.status(up.error.status).type("application/json").send(up.error.body); }
    res.set("x-bleedstop-decision", d.decision);

    if (up.json) {
      const j = up.json;
      let outTok, inTok;
      if (kind === "chat") {
        inTok = j.usage?.prompt_tokens ?? promptTokens; outTok = j.usage?.completion_tokens ?? approxTokens(j.choices?.[0]?.message?.content);
        const tc = j.choices?.[0]?.message?.tool_calls;
        if (tc?.length) {
          const ins = inspectToolCalls(tenantId, tc, actorId);
          if (ins.blocked.length) {
            inc("bleedstop_llm_tool_calls_blocked_total", "tool_calls in model output stopped by policy", { api: kind }, ins.blocked.length);
            if (enforce) {
              const keep = tc.filter((t) => !ins.blocked.some((b) => b.id === t.id));
              j.choices[0].message.tool_calls = keep.length ? keep : undefined;
              if (!keep.length) { j.choices[0].message.content = `[BleedStop held ${ins.blocked.length} tool call(s): ${ins.blocked.map((b) => `${b.name} ${b.decision}`).join(", ")}]`; j.choices[0].finish_reason = "stop"; }
            }
          }
          j.bleedstop = { ...(j.bleedstop || {}), tool_calls: ins };
        }
      } else {
        inTok = j.usage?.input_tokens ?? promptTokens; outTok = j.usage?.output_tokens ?? approxTokens(j.output_text);
      }
      const rec = await commit(inTok, outTok, false);
      j.bleedstop = { decision: d.decision, cluster: d.clusterId, outputCap: outCap, ...rec, ...(j.bleedstop || {}) };
      return res.json(j);
    }

    // streaming
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "x-bleedstop-decision": d.decision });
    let outText = "", usage = null, cut = false, last = null, toolCalls = [];
    const write = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    try {
      for await (const ev of up.stream) {
        if (kind === "chat") {
          last = ev;
          if (ev.usage) { usage = ev.usage; continue; }
          const delta = ev.choices?.[0]?.delta || {};
          if (delta.tool_calls) toolCalls.push(...delta.tool_calls);
          if (delta.content) {
            if (approxTokens(outText + delta.content) > outCap) {
              const room = outCap * 4 - outText.length;
              if (room > 0) { outText += delta.content.slice(0, room); write({ ...ev, choices: [{ index: 0, delta: { content: delta.content.slice(0, room) }, finish_reason: null }] }); }
              cut = true; ctrl.abort(); break;
            }
            outText += delta.content;
          }
          if (delta.tool_calls && enforce) continue; // released after inspection below
          write(ev);
        } else {
          if (ev.type === "response.output_text.delta") {
            if (approxTokens(outText + ev.delta) > outCap) { cut = true; ctrl.abort(); break; }
            outText += ev.delta;
          }
          if (ev.type === "response.completed") usage = ev.response?.usage;
          write(ev);
        }
      }
    } catch (err) { if (err.name !== "AbortError") write({ error: { message: err.message } }); }
    let toolInfo;
    if (kind === "chat" && toolCalls.length) {
      const merged = toolCalls.map((t) => ({ id: t.id, type: "function", function: t.function }));
      toolInfo = inspectToolCalls(tenantId, merged, actorId);
      const keep = enforce ? merged.filter((t) => !toolInfo.blocked.some((b) => b.id === t.id)) : [];
      if (enforce && keep.length) write({ ...last, choices: [{ index: 0, delta: { tool_calls: keep.map((t, i) => ({ index: i, ...t })) }, finish_reason: null }] });
      if (toolInfo.blocked.length) inc("bleedstop_llm_tool_calls_blocked_total", "tool_calls in model output stopped by policy", { api: kind }, toolInfo.blocked.length);
    }
    const inTok = usage?.prompt_tokens ?? usage?.input_tokens ?? promptTokens;
    const outTok = cut ? approxTokens(outText) : usage?.completion_tokens ?? usage?.output_tokens ?? approxTokens(outText);
    const rec = await commit(inTok, outTok, cut);
    if (kind === "chat") {
      if (cut) write({ ...(last || {}), object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "length" }] });
      write({ ...(last || {}), object: "chat.completion.chunk", choices: [], usage: { prompt_tokens: inTok, completion_tokens: outTok, total_tokens: inTok + outTok }, bleedstop: { decision: d.decision, outputCap: outCap, ...rec, tool_calls: toolInfo } });
      res.write("data: [DONE]\n\n");
    } else if (cut) {
      write({ type: "response.incomplete", response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, usage: { input_tokens: inTok, output_tokens: outTok }, bleedstop: { decision: d.decision, outputCap: outCap, ...rec } } });
    }
    res.end();
  };
}
