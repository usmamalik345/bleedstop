/**
 * REAL upstream benchmark for the OpenAI compatible proxy. Small by design so it stays on a free tier.
 * Needs a key in the environment (never printed):
 *   GROQ_API_KEY=...        -> https://api.groq.com/openai/v1, model llama-3.1-8b-instant (default)
 *   or REAL_UPSTREAM_URL + REAL_UPSTREAM_KEY + REAL_UPSTREAM_MODEL for any OpenAI compatible provider
 * Usage: node benchmark/openai/run-real.js [--n 20] [--cap 64] [--out results/real-upstream.json]
 * Method: N non streaming calls, alternating direct and via BleedStop (same prompt, max_tokens 16), latency
 * compared at p50/p99; then 3 streaming calls asking for ~1500 words with max_tokens 4000 through a proxy
 * capped at --cap output tokens, versus 1 direct streaming call with the same request (upstream usage counted).
 */
import fs from "node:fs";
import { spawn } from "node:child_process";
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const KEY = process.env.REAL_UPSTREAM_KEY || process.env.GROQ_API_KEY || process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error("No upstream key in env (GROQ_API_KEY, OPENROUTER_API_KEY or REAL_UPSTREAM_KEY). Nothing run."); process.exit(2); }
const UP = process.env.REAL_UPSTREAM_URL || (process.env.GROQ_API_KEY ? "https://api.groq.com/openai/v1" : "https://openrouter.ai/api/v1");
const MODEL = process.env.REAL_UPSTREAM_MODEL || (UP.includes("groq") ? "llama-3.1-8b-instant" : "meta-llama/llama-3.1-8b-instruct:free");
const N = Number(arg("n", 20)), CAP = Number(arg("cap", 64));
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 10) / 10; };
const port = 3850 + Math.floor(Math.random() * 90);
const srv = spawn(process.execPath, ["src/server.js"], { stdio: "ignore", env: { ...process.env, npm_lifecycle_event: "test", PORT: String(port), OPENAI_PROXY_UPSTREAM: UP, OPENAI_API_KEY: KEY, OPENAI_PROXY_SMALL_MODEL: MODEL, OPENAI_PROXY_MAX_OUTPUT_TOKENS: String(CAP), BLEEDSTOP_API_KEYS: "", RAG_ENABLED: "false", TENANT_ID: "local-dev", LLM_VELOCITY_MAX_PER_MIN: "100000" } });
const BS = `http://127.0.0.1:${port}/v1`;
for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 150)); }
const call = async (base, body, direct) => { const t = performance.now(); const r = await fetch(`${base}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json", ...(direct ? { Authorization: `Bearer ${KEY}` } : { "x-actor-id": "real-" + Math.random() }) }, body: JSON.stringify(body) }); const text = await r.text(); return { ms: performance.now() - t, status: r.status, text }; };
const small = { model: MODEL, max_tokens: 16, temperature: 0, messages: [{ role: "user", content: "Reply with the single word: ok" }] };
const d = [], p = [], errs = [];
for (let i = 0; i < N; i++) {
  const a = await call(UP, small, true), b = await call(BS, small, false);
  if (a.status === 200) d.push(a.ms); else errs.push(`direct ${a.status}`);
  if (b.status === 200) p.push(b.ms); else errs.push(`proxy ${b.status}`);
  await new Promise((r) => setTimeout(r, 1200)); // stay under free tier rate limits
}
const parse = (t) => t.split("\n\n").map((x) => x.replace(/^data: ?/, "").trim()).filter((x) => x && x !== "[DONE]").map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean);
const longReq = { model: MODEL, stream: true, max_tokens: 4000, stream_options: { include_usage: true }, messages: [{ role: "user", content: "Write a detailed 1500 word essay about the history of the printing press." }] };
const dr = await call(UP, longReq, true); const de = parse(dr.text);
const directUsage = de.find((e) => e.usage)?.usage || de.find((e) => e.x_groq?.usage)?.x_groq?.usage || null;
const streams = [];
for (let i = 0; i < 3; i++) {
  await new Promise((r) => setTimeout(r, 1500));
  const r = await call(BS, longReq, false); const ev = parse(r.text); const fin = ev.find((e) => e.bleedstop);
  streams.push({ status: r.status, ms: Math.round(r.ms), finish: ev.map((e) => e.choices?.[0]?.finish_reason).filter(Boolean).pop() || null, usage: fin?.usage || null, cutByProxy: fin?.bleedstop?.cut ?? null, outputCap: fin?.bleedstop?.outputCap ?? null, reconciledUsd: fin?.bleedstop?.actualUsd ?? null });
}
srv.kill();
const out = { suite: "openai-proxy-real-upstream-v1", ranAt: new Date().toISOString(), upstream: UP, model: MODEL, node: process.version,
  latency: { n: N, ok: { direct: d.length, proxy: p.length }, errors: errs, directMs: { p50: q(d, .5), p99: q(d, .99) }, viaProxyMs: { p50: q(p, .5), p99: q(p, .99) }, addedMsP50: Math.round((q(p, .5) - q(d, .5)) * 10) / 10 },
  streamCap: { request: "1500 word essay, max_tokens 4000, stream", proxyCap: CAP, directStatus: dr.status, directUsage, viaProxy: streams } };
if (arg("out")) fs.writeFileSync(arg("out"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
