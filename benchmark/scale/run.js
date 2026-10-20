/**
 * Scale + correctness benchmark (local processes, real Redis).
 *  Topologies: 1 instance memory | 1 instance Redis | 2 instances Redis + LB | 3 instances Redis + LB
 *  Load: N /decide calls, unique actors (no denials), concurrency C → throughput, p50/p95/p99.
 *  Correctness: 2,000 concurrent calls from ONE cluster through the LB against a $5 ceiling;
 *  reports total charged vs ceiling for atomic Lua mode and legacy mode (REDIS_ATOMIC=0).
 *
 *   node benchmark/scale/run.js --runs 3 --out scale.json
 * Needs redis-server on PATH.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";

const args = Object.fromEntries(process.argv.slice(2).join(" ").split("--").filter(Boolean).map((s) => s.trim().split(/\s+/)));
const RUNS = Number(args.runs || 3);
const N = Number(args.n || 20000);
const C = Number(args.c || 64);
const REDIS_PORT = 6390;
const procs = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const agent = new http.Agent({ keepAlive: true, maxSockets: 1024 });

function post(port, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const t = performance.now();
    const req = http.request({ host: "127.0.0.1", port, path, method: "POST", agent, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data) } }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => resolve({ status: res.statusCode, body: buf ? JSON.parse(buf) : {}, ms: performance.now() - t }));
    });
    req.on("error", reject);
    req.end(data);
  });
}
async function waitUp(port) { for (let i = 0; i < 100; i++) { try { await new Promise((ok, no) => http.get({ host: "127.0.0.1", port, path: "/api/health" }, (r) => { r.resume(); ok(); }).on("error", no)); return; } catch { await sleep(100); } } throw new Error(`port ${port} not up`); }
function start(cmd, argv, env = {}) { const p = spawn(cmd, argv, { env: { ...process.env, ...env }, stdio: "ignore" }); procs.push(p); return p; }
function stopAll() { while (procs.length) procs.pop().kill("SIGKILL"); }
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
async function pool(n, conc, fn) { const out = new Array(n); let i = 0; await Promise.all(Array.from({ length: conc }, async () => { while (i < n) { const k = i++; out[k] = await fn(k); } })); return out; }

const baseEnv = { DATABASE_URL: "", RAG_ENABLED: "0", DECIDE_RATE_PER_SEC: "0", LLM_VELOCITY_MAX_PER_MIN: "1000000", LOG_FORMAT: "text" };

async function topology({ instances, redis, atomic = true, env = {} }) {
  stopAll();
  await sleep(300);
  if (redis) { start("redis-server", ["--port", String(REDIS_PORT), "--save", "", "--appendonly", "no"]); await sleep(400); }
  const ports = Array.from({ length: instances }, (_, i) => 3101 + i);
  for (const p of ports) start("node", ["src/server.js"], { ...baseEnv, PORT: String(p), INSTANCE_ID: `i${p}`, REDIS_URL: redis ? `redis://127.0.0.1:${REDIS_PORT}` : "", REDIS_ATOMIC: atomic ? "1" : "0", ...env });
  for (const p of ports) await waitUp(p);
  let entry = ports[0];
  if (instances > 1) { start("node", ["benchmark/scale/lb.js", "3100", ...ports.map(String)]); entry = 3100; await sleep(400); }
  return entry;
}

async function load(entry, tag) {
  await post(entry, "/ledger/reset", {});
  await pool(2000, C, (k) => post(entry, "/decide", { actorId: `warm-${tag}-${k}`, action: "llm.call", paid: false, estimatedTokens: 1012, signals: { deviceFingerprint: `fpw-${tag}-${k}` } }));
  const t = performance.now();
  const res = await pool(N, C, (k) => post(entry, "/decide", { actorId: `u-${tag}-${k}`, action: "llm.call", paid: false, estimatedTokens: 1012, signals: { deviceFingerprint: `fp-${tag}-${k}`, email: `u${k}@${tag}.com` } }));
  const secs = (performance.now() - t) / 1000;
  const ms = res.map((r) => r.ms);
  return { requests: N, concurrency: C, rps: N / secs, p50: pct(ms, 50), p95: pct(ms, 95), p99: pct(ms, 99), non200: res.filter((r) => r.status !== 200).length, denied: res.filter((r) => r.body.decision === "DENY").length };
}

async function correctness(entry) {
  await post(entry, "/ledger/reset", {});
  const res = await pool(2000, 100, (k) => post(entry, "/decide", { actorId: `farm-${k}`, action: "llm.call", paid: false, signals: { deviceFingerprint: "fp-one-cluster" } }));
  const allowed = res.filter((r) => r.body.decision === "ALLOW" || r.body.decision === "LIMIT");
  const charged = allowed.reduce((s, r) => s + Number(r.body.estimatedCost || 0), 0);
  const clusters = new Set(res.map((r) => r.body.clusterId)).size;
  // Unrelated actors must NOT share a cluster id (per-process "C-n" names collide across instances)
  const solo = await pool(200, 50, (k) => post(entry, "/decide", { actorId: `solo-${k}`, action: "llm.call", paid: false, signals: { deviceFingerprint: `fp-solo-${k}` } }));
  const soloIds = new Set(solo.map((r) => r.body.clusterId)).size;
  return { unrelatedActors: 200, unrelatedDistinctClusterIds: soloIds, requests: 2000, concurrency: 100, ceilingUsd: 5, allowed: allowed.length, chargedUsd: Math.round(charged * 1e6) / 1e6, overspendUsd: Math.max(0, Math.round((charged - 5) * 1e6) / 1e6), distinctClusterIds: clusters };
}

const topologies = [
  { name: "1x memory", instances: 1, redis: false },
  { name: "1x memory + OTel OTLP export", instances: 1, redis: false, env: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318" } },
  { name: "1x redis (atomic)", instances: 1, redis: true },
  { name: "2x redis (atomic) + LB", instances: 2, redis: true },
  { name: "3x redis (atomic) + LB", instances: 3, redis: true },
  { name: "2x redis LEGACY (REDIS_ATOMIC=0) + LB", instances: 2, redis: true, atomic: false },
];
async function rateLimitCheck() {
  const entry = await topology({ instances: 1, redis: false, env: { DECIDE_RATE_PER_SEC: "100", DECIDE_BURST: "200" } });
  const t = performance.now();
  const res = await pool(1000, 50, (k) => post(entry, "/decide", { actorId: `rl-${k}`, action: "auth.login" }));
  const secs = (performance.now() - t) / 1000;
  return { sent: 1000, seconds: secs, ok: res.filter((r) => r.status === 200).length, limited429: res.filter((r) => r.status === 429).length, expectedMaxOk: Math.floor(200 + 100 * secs) + 1 };
}

async function redisOutageCheck() {
  const entry = await topology({ instances: 1, redis: true });
  const redisProc = procs[0];
  let killed = false;
  const res = await pool(4000, 32, async (k) => {
    if (k === 1000 && !killed) { killed = true; redisProc.kill("SIGKILL"); }
    return post(entry, "/decide", { actorId: `ro-${k}`, action: "llm.call", estimatedTokens: 1012, signals: { deviceFingerprint: `fp-ro-${k}` } });
  });
  const metrics = await new Promise((ok) => http.get({ host: "127.0.0.1", port: entry, path: "/metrics" }, (r) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => ok(b)); }));
  return { sent: 4000, redisKilledAtRequest: 1000, http200: res.filter((r) => r.status === 200).length, non200: res.filter((r) => r.status !== 200).length, degradedCounter: Number((metrics.match(/bleedstop_degraded_redis_total (\d+)/) || [])[1] || 0) };
}

const raw = [];
let extra = {};
try {
  for (let r = 0; r < RUNS; r++) {
    for (const t of topologies) {
      const entry = await topology(t);
      const perf = t.atomic === false ? null : await load(entry, `r${r}${t.instances}${t.redis ? "r" : "m"}`);
      const corr = await correctness(entry);
      raw.push({ run: r + 1, topology: t.name, perf, correctness: corr });
      process.stderr.write(`run ${r + 1} ${t.name}: ${JSON.stringify(perf && { rps: Math.round(perf.rps), p99: perf.p99.toFixed(2) })} ${JSON.stringify(corr)}\n`);
    }
  }
  extra = { rateLimit: await rateLimitCheck(), redisOutage: await redisOutageCheck() };
  process.stderr.write(JSON.stringify(extra) + "\n");
} finally { stopAll(); }

const med = {};
for (const t of topologies) {
  const rows = raw.filter((x) => x.topology === t.name);
  const m = { correctness: { allowedMedian: median(rows.map((x) => x.correctness.allowed)), chargedUsdMax: Math.max(...rows.map((x) => x.correctness.chargedUsd)), overspendUsdMax: Math.max(...rows.map((x) => x.correctness.overspendUsd)), distinctClusterIdsMax: Math.max(...rows.map((x) => x.correctness.distinctClusterIds)), unrelatedDistinctClusterIdsMin: Math.min(...rows.map((x) => x.correctness.unrelatedDistinctClusterIds)) } };
  if (rows[0].perf) m.perf = Object.fromEntries(["rps", "p50", "p95", "p99", "non200"].map((k) => [k, median(rows.map((x) => x.perf[k]))]));
  med[t.name] = m;
}
const out = { at: new Date().toISOString(), node: process.version, cpus: (await import("node:os")).cpus().length, runs: RUNS, n: N, concurrency: C, median: med, checks: extra, raw };
fs.writeFileSync(args.out || "scale-results.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(med, null, 2));
process.exit(0);
