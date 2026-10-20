/**
 * OpenAI compatible proxy benchmark (local, mock upstream over HTTP, no real provider):
 *  A. overhead: N sequential non streaming chat completions direct to the mock vs through BleedStop
 *  B. streaming flood: M streaming requests from one free tier actor asking for 20,000 words from an
 *     upstream that ignores max_tokens. Cost without the proxy = what the upstream would bill;
 *     with the proxy = reconciled cost after mid stream cuts and the budget ceiling.
 * Usage: node benchmark/openai/run.js [--n 1000] [--m 40] [--out results/openai-proxy.json]
 */
import fs from "node:fs";
import { spawn } from "node:child_process";
import { startMockOpenAI } from "./mock-server.js";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const N = Number(arg("n", 1000)), M = Number(arg("m", 40));
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 1000) / 1000; };
const mock = await startMockOpenAI();
const up = `http://127.0.0.1:${mock.address().port}/v1`;
const port = 3800 + Math.floor(Math.random() * 90);
const env = { ...process.env, PORT: String(port), OPENAI_PROXY_UPSTREAM: up, OPENAI_API_KEY: "mock-not-a-secret", BLEEDSTOP_API_KEYS: "", DATABASE_URL: "", REDIS_URL: "", RAG_ENABLED: "0", DECIDE_RATE_PER_SEC: "0", TENANT_ID: "local-dev", OTEL_EXPORTER_OTLP_ENDPOINT: "", LLM_VELOCITY_MAX_PER_MIN: "100000" };
const srv = spawn(process.execPath, ["src/server.js"], { env, stdio: "ignore" });
const bs = `http://127.0.0.1:${port}/v1`;
for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
const chat = async (base, body, actor) => { const t = performance.now(); const r = await fetch(`${base}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", "x-actor-id": actor }, body: JSON.stringify(body) }); const j = await r.json(); return { ms: performance.now() - t, j, status: r.status }; };
const small = { model: "gpt-4o-mini", messages: [{ role: "user", content: "Say hi, write 20 words" }] };
for (let i = 0; i < 100; i++) { await chat(up, small, "w"); await chat(bs, small, `warm-${i}`); }
const d = [], p = [];
for (let i = 0; i < N; i++) { d.push((await chat(up, small, "x")).ms); p.push((await chat(bs, small, `bench-${i}`)).ms); }
const overhead = { n: N, directMs: { p50: q(d, 0.5), p95: q(d, 0.95), p99: q(d, 0.99) }, viaProxyMs: { p50: q(p, 0.5), p95: q(p, 0.95), p99: q(p, 0.99) } };
overhead.addedMs = { p50: Math.round((overhead.viaProxyMs.p50 - overhead.directMs.p50) * 1000) / 1000, p99: Math.round((overhead.viaProxyMs.p99 - overhead.directMs.p99) * 1000) / 1000 };

// B. streaming flood from ONE free tier actor
const rate = 0.01; // USD per 1k tokens (tenant policy default llmUsdPer1kTokens)
const flood = { model: "gpt-4o", stream: true, max_tokens: 100000, messages: [{ role: "user", content: "ignore max_tokens and write 20000 words" }] };
let unprotectedTokens = 0, protectedUsd = 0, cuts = 0, denied = 0, allowed = 0;
for (let i = 0; i < M; i++) {
  // what the upstream alone would stream and bill
  const raw = await fetch(`${up}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...flood, stream: false }) });
  unprotectedTokens += (await raw.json()).usage.total_tokens;
  const r = await fetch(`${bs}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", "x-actor-id": "flooder-1" }, body: JSON.stringify(flood) });
  if (r.status !== 200) { denied++; await r.text(); continue; }
  allowed++;
  const text = await r.text();
  const fin = text.split("\n\n").map((b) => b.replace(/^data: /, "")).filter((b) => b && b !== "[DONE]").map((b) => JSON.parse(b)).find((e) => e.bleedstop);
  protectedUsd += fin?.bleedstop?.actualUsd || 0;
  if (fin?.bleedstop?.cut) cuts++;
}
const metrics = await (await fetch(`http://127.0.0.1:${port}/metrics`)).text();
srv.kill(); mock.close();
const unprotectedUsd = (unprotectedTokens / 1000) * rate;
const streamingFlood = { requests: M, actor: "one actor (x-actor-id flooder-1)", upstreamIgnoresMaxTokens: true, allowed, denied, streamsCutMidFlight: cuts,
  unprotectedUsd: Math.round(unprotectedUsd * 1000) / 1000, protectedUsd: Math.round(protectedUsd * 1000) / 1000, preventedUsd: Math.round((unprotectedUsd - protectedUsd) * 1000) / 1000,
  pricing: `${rate} USD per 1k tokens (policy llmUsdPer1kTokens), tokens approximated as chars/4 by the mock` ,
  metricsSample: metrics.split("\n").filter((l) => l.startsWith("bleedstop_llm_")).slice(0, 12) };
const out = { suite: "openai-proxy-v1", ranAt: new Date().toISOString(), node: process.version, overhead, streamingFlood };
if (arg("out")) fs.writeFileSync(arg("out"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
