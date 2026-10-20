/**
 * BleedStop attack suite: measures block rate, false positives, $ saved,
 * added latency and throughput against a deterministic mock LLM upstream.
 *
 *   npm start                     # BleedStop on :3000 (RAG_ENABLED=0 is fine)
 *   node benchmark/attack-suite/run.js [--runs 3] [--out results.json] [--label baseline]
 */
import fs from "node:fs";
import { startMockLlm, PRICE } from "./mock-llm.js";
import { startGateway } from "./gateway.js";

const args = Object.fromEntries(process.argv.slice(2).join(" ").split("--").filter(Boolean).map((s) => s.trim().split(/\s+/)));
const RUNS = Number(args.runs || 3);
const OUT = args.out || "attack-results.json";
const LABEL = args.label || "run";
const BS = process.env.BLEEDSTOP_URL || "http://localhost:3000";
let RUN_NONCE = 0; // fresh key per run so SDK cache from an earlier run cannot help
const MOCK = 4900, DIRECT = 4901, PROT = 4902;

const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const P = (n) => "x".repeat(n);

async function post(url, body) {
  const t = performance.now();
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, decision: j.decision, ms: performance.now() - t };
}
async function pool(items, conc, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: conc }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}
const bill = async () => (await fetch(`http://localhost:${MOCK}/bill`)).json();
const resetAll = async () => { await fetch(`${BS}/ledger/reset`, { method: "POST" }); await fetch(`http://localhost:${MOCK}/bill/reset`, { method: "POST" }); };

// ---- traffic generators (deterministic) ----
const scen = {
  normal_baseline: { abusive: false, conc: 8, gen: () => {
    const r = []; for (let u = 0; u < 200; u++) for (let k = 0; k < 5; k++)
      r.push({ actorId: `user-${u}`, email: `person${u}@company${u % 37}.com`, deviceFingerprint: `fp-user-${u}`, ip: `10.1.${u >> 8}.${u & 255}`, prompt: P(2000), maxTokens: 512 });
    return r; } },
  free_tier_farm_shared_device: { abusive: true, conc: 8, gen: () => {
    const r = []; for (let a = 0; a < 100; a++) for (let k = 0; k < 20; k++)
      r.push({ actorId: `farm-${a}`, email: `bot${a}@mailbox${a}.net`, deviceFingerprint: "fp-farm-shared", ip: `203.0.${a >> 8}.${a & 255}`, prompt: P(2000), maxTokens: 512 });
    return r; } },
  free_tier_farm_rotating_all_signals: { abusive: true, conc: 8, gen: () => {
    const r = []; for (let a = 0; a < 100; a++) for (let k = 0; k < 20; k++)
      r.push({ actorId: `rot-${a}`, email: `rot${a}@mailbox${a}.net`, deviceFingerprint: `fp-rot-${a}`, ip: `198.51.${a >> 8}.${a & 255}`, prompt: P(2000), maxTokens: 512 });
    return r; } },
  token_flood_400k_char_prompts: { abusive: true, conc: 4, gen: () => {
    const r = []; for (let k = 0; k < 200; k++)
      r.push({ actorId: "flooder", email: "flooder@x.io", deviceFingerprint: "fp-flood", ip: "192.0.2.9", prompt: P(400_000), maxTokens: 4096 });
    return r; } },
  retry_storm_no_idempotency: { abusive: true, conc: 50, gen: () => {
    const r = []; for (let k = 0; k < 1000; k++)
      r.push({ actorId: "looper", email: "looper@x.io", deviceFingerprint: "fp-loop", ip: "192.0.2.10", prompt: P(2000), maxTokens: 512 });
    return r; } },
  retry_storm_same_idempotency_key: { abusive: true, conc: 50, gen: () => {
    const r = []; for (let k = 0; k < 1000; k++)
      r.push({ actorId: "looper2", email: "looper2@x.io", deviceFingerprint: "fp-loop2", ip: "192.0.2.11", prompt: P(2000), maxTokens: 512, idempotencyKey: `retry-job-${RUN_NONCE}` });
    return r; } },
};

async function runScenario(name, s) {
  RUN_NONCE += 1;
  const reqs = s.gen();
  await resetAll();
  await pool(reqs, s.conc, (b) => post(`http://localhost:${DIRECT}/chat`, b));
  const direct = await bill();
  await resetAll();
  const res = await pool(reqs, s.conc, (b) => post(`http://localhost:${PROT}/chat`, b));
  const prot = await bill();
  const count = (d) => res.filter((x) => x.decision === d).length;
  const blocked = count("DENY") + count("CHALLENGE");
  const n = reqs.length;
  return {
    requests: n, replay: count("REPLAY"), allow: count("ALLOW"), limit: count("LIMIT"), deny: count("DENY"), challenge: count("CHALLENGE"),
    errors: res.filter((x) => x.status >= 500).length,
    blockedPct: (100 * blocked) / n,
    upstreamCallsPreventedPct: direct.calls ? (100 * (direct.calls - prot.calls)) / direct.calls : 0, limitedPct: (100 * count("LIMIT")) / n,
    upstreamUsdDirect: direct.usd, upstreamUsdProtected: prot.usd,
    upstreamCallsDirect: direct.calls, upstreamCallsProtected: prot.calls,
    savedUsd: direct.usd - prot.usd, savedUsdPer1000: ((direct.usd - prot.usd) / n) * 1000,
    abusive: s.abusive,
  };
}

async function perf() {
  // latency: sequential, unique users (never near a ceiling)
  const mk = (tag, n) => Array.from({ length: n }, (_, i) => ({ actorId: `${tag}-${i}`, email: `${tag}${i}@ok.com`, deviceFingerprint: `fp-${tag}-${i}`, prompt: P(2000), maxTokens: 512 }));
  await resetAll();
  for (const b of mk("warm", 200)) { await post(`http://localhost:${DIRECT}/chat`, b); await post(`http://localhost:${PROT}/chat`, b); }
  await resetAll();
  const d = [], p = [];
  for (const b of mk("lat", 1000)) { d.push((await post(`http://localhost:${DIRECT}/chat`, b)).ms); p.push((await post(`http://localhost:${PROT}/chat`, b)).ms); }
  const tput = async (port, tag) => { await resetAll(); const items = mk(tag, 3000); const t = performance.now(); await pool(items, 32, (b) => post(`http://localhost:${port}/chat`, b)); return items.length / ((performance.now() - t) / 1000); };
  return {
    latencyMs: { directP50: pct(d, 50), directP95: pct(d, 95), protectedP50: pct(p, 50), protectedP95: pct(p, 95), addedP50: pct(p, 50) - pct(d, 50), addedP95: pct(p, 95) - pct(d, 95) },
    throughputRps: { direct: await tput(DIRECT, "td"), protected: await tput(PROT, "tp") },
  };
}

const mock = await startMockLlm(MOCK);
const g1 = await startGateway({ port: DIRECT, upstream: `http://localhost:${MOCK}`, bleedstopUrl: BS, protect: false });
const g2 = await startGateway({ port: PROT, upstream: `http://localhost:${MOCK}`, bleedstopUrl: BS, protect: true });

const runs = [];
for (let r = 0; r < RUNS; r++) {
  const one = { scenarios: {} };
  for (const [name, s] of Object.entries(scen)) { one.scenarios[name] = await runScenario(name, s); process.stderr.write(`run ${r + 1} ${name} done\n`); }
  one.perf = await perf(); process.stderr.write(`run ${r + 1} perf done\n`);
  runs.push(one);
}
const med = { scenarios: {}, perf: {} };
for (const name of Object.keys(scen)) {
  med.scenarios[name] = {};
  for (const k of Object.keys(runs[0].scenarios[name])) { const v = runs.map((x) => x.scenarios[name][k]); med.scenarios[name][k] = typeof v[0] === "number" ? median(v) : v[0]; }
}
for (const grp of ["latencyMs", "throughputRps"]) { med.perf[grp] = {}; for (const k of Object.keys(runs[0].perf[grp])) med.perf[grp][k] = median(runs.map((x) => x.perf[grp][k])); }
const out = { label: LABEL, at: new Date().toISOString(), node: process.version, runs: RUNS, priceAssumption: PRICE, bleedstopUrl: BS, median: med, raw: runs };
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(JSON.stringify(med, null, 2));
mock.close(); g1.close(); g2.close(); process.exit(0);
