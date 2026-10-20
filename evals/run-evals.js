/**
 * Eval runner: replays the golden set against a BleedStop server and scores decisions.
 *   positive (predicted abusive) = DENY or CHALLENGE ; negative = ALLOW or LIMIT
 * Per scenario: TP/FP/FN/TN, precision, recall, F1, FP rate. Requests are replayed in file
 * order, sequentially (deterministic), with a full /ledger/reset before each scenario.
 *
 *   node evals/run-evals.js [--golden evals/golden/traffic-v1.jsonl] [--code .] [--label x]
 *        [--env KEY=VAL,KEY=VAL] [--out evals/results.json] [--md evals/REPORT.md] [--gate]
 * Spawns its own server (memory mode) on --port (default 3300), or with --url http://host:port
 * replays against an already running deployment (compose / Kubernetes) instead.
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const GOLDEN = opt("golden", "evals/golden/traffic-v1.jsonl");
const CODE = path.resolve(opt("code", "."));
const LABEL = opt("label", "current");
const URL_OPT = opt("url", "");
const TARGET = URL_OPT ? new URL(URL_OPT) : null;
const HOST = TARGET ? TARGET.hostname : "127.0.0.1";
const PORT = TARGET ? Number(TARGET.port || 80) : Number(opt("port", 3300));
const EXTRA = Object.fromEntries((opt("env", "") || "").split(",").filter(Boolean).map((kv) => kv.split("=")));
const agent = new http.Agent({ keepAlive: true });

function post(p, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ host: HOST, port: PORT, path: p, method: "POST", agent, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data) } }, (res) => {
      let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : {} }));
    });
    req.on("error", reject); req.end(data);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function score(rows) {
  const s = { TP: 0, FP: 0, FN: 0, TN: 0 };
  for (const r of rows) {
    const pos = r.predicted === "DENY" || r.predicted === "CHALLENGE";
    if (r.label === "abusive") pos ? s.TP++ : s.FN++;
    else pos ? s.FP++ : s.TN++;
  }
  const precision = s.TP + s.FP ? s.TP / (s.TP + s.FP) : null;
  const recall = s.TP + s.FN ? s.TP / (s.TP + s.FN) : null;
  const f1 = precision != null && recall != null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null;
  const fpRate = s.FP + s.TN ? s.FP / (s.FP + s.TN) : null;
  return { n: rows.length, ...s, precision, recall, f1, fpRate };
}

async function main() {
  const lines = fs.readFileSync(GOLDEN, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const env = { ...process.env, PORT: String(PORT), DATABASE_URL: "", REDIS_URL: "", RAG_ENABLED: "0", DECIDE_RATE_PER_SEC: "0", LOG_FORMAT: "text", ...EXTRA };
  const srv = TARGET ? { kill() {} } : spawn("node", ["src/server.js"], { cwd: CODE, env, stdio: "ignore" });
  try {
    for (let i = 0; i < 100; i++) { try { await post("/ledger/reset", {}); break; } catch { await sleep(100); } }
    const byScenario = new Map();
    for (const r of lines) { if (!byScenario.has(r.scenario)) byScenario.set(r.scenario, []); byScenario.get(r.scenario).push(r); }
    const results = {};
    const all = [];
    for (const [sc, rows] of byScenario) {
      await post("/ledger/reset", {});
      const scored = [];
      for (const r of rows) {
        const res = await post("/decide", r.request);
        scored.push({ id: r.id, label: r.label, predicted: res.body.decision || `HTTP_${res.status}` });
      }
      results[sc] = { label: rows[0].label, ...score(scored) };
      all.push(...scored);
    }
    const benign = all.filter((r) => r.label === "benign");
    const out = {
      label: LABEL, golden: GOLDEN, goldenSha256: (await import("node:crypto")).createHash("sha256").update(fs.readFileSync(GOLDEN)).digest("hex"),
      env: EXTRA, at: new Date().toISOString(), overall: score(all), benignOnly: score(benign), scenarios: results,
    };
    return out;
  } finally { srv.kill("SIGKILL"); }
}

const fmt = (x) => (x == null ? "n/a" : (x * 100).toFixed(1) + "%");
export function toMarkdown(runs) {
  const L = ["# BleedStop eval report", "", `Golden set: \`${runs[0].golden}\` (sha256 \`${runs[0].goldenSha256.slice(0, 16)}…\`). Positive = DENY or CHALLENGE. Sequential replay, state reset per scenario, memory mode. Benign scenarios have no positives, so precision/recall are n/a there and only FP rate matters; abusive scenarios have no negatives, so only recall matters.`, ""];
  for (const r of runs) {
    L.push(`## ${r.label}${Object.keys(r.env).length ? ` (${Object.entries(r.env).map(([k, v]) => `${k}=${v}`).join(", ")})` : ""}`, "");
    L.push("| Scenario | Label | N | TP | FP | FN | TN | Precision | Recall | F1 | FP rate |", "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
    for (const [k, v] of Object.entries(r.scenarios)) L.push(`| ${k} | ${v.label} | ${v.n} | ${v.TP} | ${v.FP} | ${v.FN} | ${v.TN} | ${fmt(v.precision)} | ${fmt(v.recall)} | ${fmt(v.f1)} | ${fmt(v.fpRate)} |`);
    const o = r.overall;
    L.push(`| **overall** | | ${o.n} | ${o.TP} | ${o.FP} | ${o.FN} | ${o.TN} | ${fmt(o.precision)} | ${fmt(o.recall)} | ${fmt(o.f1)} | ${fmt(o.fpRate)} |`, "");
  }
  return L.join("\n");
}

/** CI gate thresholds (current default config) */
export function gate(r) {
  const s = r.scenarios, f = [];
  for (const k of ["normal_users", "shared_household_device", "office_nat_same_ip", "campus_nat_one_subnet", "isp_many_new_users"]) if (s[k].fpRate > 0.0) f.push(`${k} FP rate ${fmt(s[k].fpRate)} > 0`);
  if (s.token_flood.recall < 0.99) f.push("token_flood recall < 99%");
  if (s.farm_shared_device.recall < 0.9) f.push("farm_shared_device recall < 90%");
  if (s.retry_storm.recall < 0.9) f.push("retry_storm recall < 90%");
  if (s.rotated_same_subnet.recall < 0.4) f.push("rotated_same_subnet recall < 40%");
  if (r.overall.precision < 0.99) f.push("overall precision < 99%");
  return f;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await main();
  const outPath = opt("out", null);
  if (outPath) {
    const prev = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, "utf8")) : [];
    const runs = [...prev.filter((x) => x.label !== r.label), r];
    fs.writeFileSync(outPath, JSON.stringify(runs, null, 2));
    const md = opt("md", null);
    if (md) fs.writeFileSync(md, toMarkdown(runs));
  }
  console.log(toMarkdown([r]));
  if (argv.includes("--gate")) {
    const f = gate(r);
    if (f.length) { console.error("EVAL GATE FAILED:\n  " + f.join("\n  ")); process.exit(1); }
    console.log("EVAL GATE PASSED");
  }
  process.exit(0);
}
