/**
 * Local load test. Same machine, two servers:
 *   mock upstream = answers immediately (no internet)
 *   BleedStop     = POST /decide
 * Added latency = BleedStop percentile minus mock percentile.
 *
 * autocannon measures sustained requests/second.
 * A second timed run records every latency so we can report p95
 * (autocannon's table has p50, p90, p97.5, p99, not p95).
 *
 *   npm run loadtest
 */
import autocannon from "autocannon";
import http from "node:http";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BS_PORT = Number(process.env.LOAD_BS_PORT || 3211);
const MOCK_PORT = Number(process.env.LOAD_MOCK_PORT || 3212);
const DURATION = Number(process.env.LOAD_DURATION_SEC || 6);
const CONN = Number(process.env.LOAD_CONNECTIONS || 24);

const round = (n) => (n == null || Number.isNaN(n) ? null : Math.round(n * 1000) / 1000);

/** Nearest-rank percentile. Sorted ascending. Index = ceil(p * n) - 1. */
function pct(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return round(sorted[idx]);
}

function machine() {
  const cpus = os.cpus();
  return {
    date: new Date().toISOString(),
    platform: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    cpu: cpus[0]?.model || "unknown",
    cpuCount: cpus.length,
    memBytes: os.totalmem(),
    node: process.version,
  };
}

function startMock() {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, bytes: Buffer.concat(chunks).length }));
    });
  });
  return new Promise((resolve) => server.listen(MOCK_PORT, "127.0.0.1", () => resolve(server)));
}

function startBleedstop() {
  // Allowlist only. Do not copy the parent environment (it may hold keys).
  // Empty DATABASE_URL / REDIS_URL win over .env because dotenv does not override.
  const env = {
    PATH: process.env.PATH || "",
    Path: process.env.Path || "",
    SystemRoot: process.env.SystemRoot || "",
    PATHEXT: process.env.PATHEXT || "",
    TEMP: process.env.TEMP || "",
    TMP: process.env.TMP || "",
    PORT: String(BS_PORT),
    DATABASE_URL: "",
    REDIS_URL: "",
    RAG_ENABLED: "0",
    DECIDE_RATE_PER_SEC: "0",
    BLEEDSTOP_API_KEYS: "",
    DASHBOARD_USERS: "",
    LOG_FORMAT: "text",
    AGENT_MODE: "template",
  };
  const child = spawn(process.execPath, ["src/server.js"], { cwd: ROOT, env, stdio: ["ignore", "ignore", "pipe"] });
  let err = "";
  child.stderr.on("data", (b) => { err = (err + b.toString()).slice(-2000); });
  child.exited = new Promise((resolve) => child.on("exit", resolve));
  child.errTail = () => err;
  return child;
}

async function waitOk(url) {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch { /* still booting */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no answer from ${url}`);
}

function postJson(url, body) {
  const u = new URL(url);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname, method: "POST",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString();
        let json = null;
        try { json = JSON.parse(text); } catch { /* non json */ }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Open `concurrency` workers. Each keeps sending until `durationSec` is up.
 * Every successful response latency is kept (that is the p95 sample).
 */
function sample(url, makeBody, { durationSec, concurrency, trackDecisions }) {
  const agent = new http.Agent({ keepAlive: true, maxSockets: concurrency });
  const u = new URL(url);
  const lats = [];
  const decisions = {};
  let errors = 0;
  let seq = 0;
  let sent = 0;
  let done = 0;
  let chargedUsd = 0;
  let overCeiling = 0;
  const tStart = performance.now();
  const stopAt = tStart + durationSec * 1000;

  return new Promise((resolve) => {
    let finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      agent.destroy();
      const sorted = lats.slice().sort((a, b) => a - b);
      const elapsed = (performance.now() - tStart) / 1000;
      resolve({
        n: lats.length,
        errors,
        elapsedSec: round(elapsed),
        rps: round(lats.length / elapsed),
        decisions,
        chargedUsd: round(chargedUsd),
        overCeiling,
        p50: pct(sorted, 0.5),
        p95: pct(sorted, 0.95),
        p99: pct(sorted, 0.99),
      });
    }
    function launch() {
      if (finished) return;
      if (performance.now() >= stopAt) {
        if (done >= sent) finish();
        return;
      }
      const payload = JSON.stringify(makeBody(seq++));
      sent++;
      const t0 = performance.now();
      const req = http.request({
        hostname: u.hostname, port: u.port, path: u.pathname, method: "POST", agent,
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) },
      }, (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          done++;
          if (res.statusCode >= 200 && res.statusCode < 300) {
            lats.push(performance.now() - t0);
            if (trackDecisions) {
              try {
                const j = JSON.parse(Buffer.concat(chunks).toString());
                const d = j.decision || "NONE";
                decisions[d] = (decisions[d] || 0) + 1;
                if ((d === "ALLOW" || d === "LIMIT") && Number.isFinite(Number(j.estimatedCost))) {
                  chargedUsd += Number(j.estimatedCost);
                }
                if (Number.isFinite(Number(j.spendAfter)) && Number.isFinite(Number(j.ceilingUsd)) && Number(j.spendAfter) > Number(j.ceilingUsd) + 1e-9) {
                  overCeiling++;
                }
              } catch { errors++; }
            }
          } else errors++;
          launch();
        });
      });
      req.setTimeout(10000, () => req.destroy());
      req.on("error", () => { done++; errors++; launch(); });
      req.write(payload);
      req.end();
    }
    for (let i = 0; i < concurrency; i++) launch();
  });
}

function sustained(url, makeBody) {
  // One fixed body. autocannon 8's [<id>] placeholder advertises a content-length
  // that is longer than the id it inserts, so those runs never complete a response.
  return autocannon({
    url,
    connections: CONN,
    duration: DURATION,
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(makeBody(0)),
  });
}

const scenarios = {
  normal_users: {
    expect: "ALLOW",
    // Fresh person each call: own device, own IP, small prompt.
    body: (i) => ({
      actorId: `norm-${i}`,
      action: "llm.call",
      paid: false,
      estimatedTokens: 200,
      signals: { deviceFingerprint: `fp-n-${i}`, email: `n${i}@example.com`, ip: `203.0.${(i >> 8) & 255}.${i & 255}` },
    }),
  },
  leaked_key_flood: {
    expect: "ceiling",
    // Many accounts, one device. Big-but-legal token estimate so the $ ceiling hits before the 60/min velocity cap.
    body: (i) => ({
      actorId: `leak-${i}`,
      action: "llm.call",
      paid: false,
      estimatedTokens: 30000,
      signals: { deviceFingerprint: "fp-leaked-one-device", email: `l${i}@mail.test`, ip: "198.51.100.10" },
    }),
  },
  retry_storm: {
    expect: "velocity_or_ceiling",
    body: (i) => ({
      actorId: "retry-same-user",
      action: "llm.call",
      paid: false,
      estimatedTokens: 500,
      signals: { deviceFingerprint: "fp-retry", email: "retry@example.com", ip: "192.0.2.20" },
    }),
  },
  token_flood: {
    expect: "DENY",
    body: (i) => ({
      actorId: `tok-${i}`,
      action: "llm.call",
      paid: false,
      estimatedTokens: 400000,
      signals: { deviceFingerprint: `fp-t-${i}`, email: `t${i}@example.com`, ip: `203.1.${(i >> 8) & 255}.${i & 255}` },
    }),
  },
};

function correctCount(name, sampleRow) {
  const n = sampleRow.n;
  const d = sampleRow.decisions;
  if (name === "normal_users") return { correct: d.ALLOW || 0, n, rule: "ALLOW (fresh unpaid user, 200 tokens)" };
  if (name === "token_flood") return { correct: d.DENY || 0, n, rule: "DENY (400000 tokens over the unpaid per-request cap)" };
  const bad = sampleRow.overCeiling;
  return {
    correct: n - bad,
    n,
    rule: "ALLOW, LIMIT or DENY, and spendAfter never above that response's ceiling",
  };
}

function fmt(n) { return n == null ? "n/a" : String(n); }

async function main() {
  const hw = machine();
  const mock = await startMock();
  const bs = startBleedstop();
  let health;
  try {
    health = await waitOk(`http://127.0.0.1:${BS_PORT}/api/health`);
  } catch (err) {
    bs.kill();
    mock.close();
    console.error(bs.errTail());
    throw err;
  }

  const out = { hardware: hw, durationSec: DURATION, connections: CONN, ceilingUsd: health.unpaidCeilingUsd, scenarios: {} };

  for (const [name, sc] of Object.entries(scenarios)) {
    await postJson(`http://127.0.0.1:${BS_PORT}/ledger/reset`, {});
    const mockSample = await sample(`http://127.0.0.1:${MOCK_PORT}/echo`, sc.body, { durationSec: DURATION, concurrency: CONN, trackDecisions: false });
    await postJson(`http://127.0.0.1:${BS_PORT}/ledger/reset`, {});
    const bsSample = await sample(`http://127.0.0.1:${BS_PORT}/decide`, sc.body, { durationSec: DURATION, concurrency: CONN, trackDecisions: true });
    const stats = await (await fetch(`http://127.0.0.1:${BS_PORT}/api/stats`)).json();
    const maxSpend = (stats.clusters || []).reduce((m, c) => Math.max(m, Number(c.spend) || 0), 0);
    const ac = await sustained(`http://127.0.0.1:${BS_PORT}/decide`, sc.body);
    const added = {
      p50: round(bsSample.p50 - mockSample.p50),
      p95: round(bsSample.p95 - mockSample.p95),
      p99: round(bsSample.p99 - mockSample.p99),
    };
    out.scenarios[name] = {
      expect: sc.expect,
      mock: mockSample,
      bleedstop: bsSample,
      addedLatencyMs: added,
      autocannon: {
        requestsPerSec: ac.requests.average,
        p50: ac.latency.p50,
        p90: ac.latency.p90,
        p97_5: ac.latency.p97_5,
        p99: ac.latency.p99,
        errors: ac.errors,
        timeouts: ac.timeouts,
        non2xx: ac.non2xx,
        total: ac.requests.total,
      },
      maxClusterSpendUsd: maxSpend,
      correctness: correctCount(name, bsSample),
    };
    console.log(name, "rps", ac.requests.average, "added p50", added.p50, "decisions", bsSample.decisions);
  }

  bs.kill();
  mock.close();
  await bs.exited;

  const jsonPath = path.join(ROOT, "results", "loadtest.json");
  const mdPath = path.join(ROOT, "results", "LOADTEST-REPORT.md");
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2));
  fs.writeFileSync(mdPath, renderMd(out));
  console.log("wrote", mdPath);
}

function renderMd(out) {
  const h = out.hardware;
  const lines = [];
  lines.push("# Load test (local mock upstream)");
  lines.push("");
  lines.push("BleedStop and a local mock upstream ran on the same machine, one after the other, so the difference is BleedStop's own work. This is not a call to a model provider. A provider's own time would dominate a real end-to-end call.");
  lines.push("");
  lines.push("## Machine");
  lines.push("");
  lines.push(`- Date: ${h.date}`);
  lines.push(`- OS: ${h.platform} (${h.arch})`);
  lines.push(`- CPU: ${h.cpu} x ${h.cpuCount}`);
  lines.push(`- Memory: ${h.memBytes} bytes`);
  lines.push(`- Node: ${h.node}`);
  lines.push(`- Unpaid ceiling read from /api/health: $${out.ceilingUsd}`);
  lines.push("");
  lines.push("## How to run");
  lines.push("");
  lines.push("```bash");
  lines.push("npm install");
  lines.push("npm run loadtest");
  lines.push("```");
  lines.push("");
  lines.push(`Each scenario samples for ${out.durationSec}s at concurrency ${out.connections} (this is the row's N, percentiles, decisions, sample req/s, and max spend). Then autocannon v8 runs the first body of that scenario again for ${out.durationSec}s with ${out.connections} connections. autocannon's body is fixed, so that column is one account repeated. State is cleared with POST /ledger/reset before each BleedStop sample. Redis and Postgres are off.`);
  lines.push("");
  lines.push("Percentile method for the sample columns: sort the latencies, index = ceil(p * N) - 1. autocannon does not publish p95; its columns below are the ones it does publish (p50, p90, p97.5, p99).");
  lines.push("");
  lines.push("## Results");
  lines.push("");
  lines.push("| Scenario | N (sample) | sample req/s | autocannon req/s | errors | p50 ms BleedStop | p95 ms | p99 ms | p50 ms mock | added p50 | added p95 | added p99 | decisions | correct / N | max cluster spend USD |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|");
  for (const [name, s] of Object.entries(out.scenarios)) {
    const b = s.bleedstop;
    const m = s.mock;
    const dec = Object.entries(b.decisions).map(([k, v]) => `${k} ${v}`).join(", ") || "none";
    lines.push(`| ${name} | ${b.n} | ${b.rps} | ${s.autocannon.requestsPerSec} | ${b.errors + s.autocannon.errors + s.autocannon.timeouts} | ${fmt(b.p50)} | ${fmt(b.p95)} | ${fmt(b.p99)} | ${fmt(m.p50)} | ${fmt(s.addedLatencyMs.p50)} | ${fmt(s.addedLatencyMs.p95)} | ${fmt(s.addedLatencyMs.p99)} | ${dec} | ${s.correctness.correct} / ${s.correctness.n} | ${s.maxClusterSpendUsd} |`);
  }
  lines.push("");
  lines.push("## What \"correct\" means");
  lines.push("");
  for (const [name, s] of Object.entries(out.scenarios)) {
    lines.push(`- ${name}: ${s.correctness.rule}`);
  }
  lines.push("");
  lines.push("Added latency is BleedStop sample percentile minus the mock sample percentile. A negative number means the mock run was slower on that percentile (timer noise or a cold socket). The two runs are sequential, not parallel.");
  lines.push("");
  lines.push("Raw JSON: `results/loadtest.json`.");
  lines.push("");
  return lines.join("\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
