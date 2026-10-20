/**
 * Race: 3 BleedStop processes, one Postgres, one cluster, one ceiling.
 * Succeeds only if charged dollars stay at or under the ceiling.
 *
 * Local (Docker):  node deploy/k8s/race.js
 * Against kind:    node deploy/k8s/race.js --url http://127.0.0.1:3000 --n 80
 */
import http from "node:http";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const urlArg = args.includes("--url") ? args[args.indexOf("--url") + 1] : "";
const n = Number(args.includes("--n") ? args[args.indexOf("--n") + 1] : 120);
const outPath = args.includes("--out")
  ? path.resolve(args[args.indexOf("--out") + 1])
  : path.join(ROOT, "results", "MULTI-INSTANCE-REPORT.md");

function machine() {
  const cpus = os.cpus();
  return {
    date: new Date().toISOString(),
    platform: `${os.platform()} ${os.release()} (${os.arch()})`,
    cpu: `${cpus[0]?.model || "unknown"} x ${cpus.length}`,
    memBytes: os.totalmem(),
    node: process.version,
  };
}

function post(url, body) {
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
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString()); } catch { /* ignore */ }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function waitHealth(base) {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) return await r.json();
    } catch { /* booting */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`health failed for ${base}`);
}

function childEnv(port, databaseUrl) {
  return {
    PATH: process.env.PATH || "",
    Path: process.env.Path || "",
    SystemRoot: process.env.SystemRoot || "",
    PATHEXT: process.env.PATHEXT || "",
    TEMP: process.env.TEMP || "",
    TMP: process.env.TMP || "",
    PORT: String(port),
    DATABASE_URL: databaseUrl,
    BUDGET_STORE: "postgres",
    REDIS_URL: "",
    RAG_ENABLED: "0",
    DECIDE_RATE_PER_SEC: "0",
    BLEEDSTOP_API_KEYS: "",
    DASHBOARD_USERS: "",
    UNPAID_CEILING_USD: "1",
    LOG_FORMAT: "text",
    // Tests set this. A race must be allowed to open Postgres.
    FORCE_DB: "1",
    npm_lifecycle_event: "start",
  };
}

async function runAgainst(bases, ceiling) {
  const body = {
    actorId: "race-user",
    action: "llm.call",
    paid: false,
    estimatedTokens: 20000,
    signals: { deviceFingerprint: "fp-race", email: "race@example.com", ip: "203.0.113.10" },
  };
  const results = await Promise.all(Array.from({ length: n }, (_, i) => post(`${bases[i % bases.length]}/decide`, body)));
  const decisions = {};
  let charged = 0;
  let errors = 0;
  let maxSpendAfter = 0;
  for (const r of results) {
    if (!r.json || r.status !== 200) { errors++; continue; }
    const d = r.json.decision || "NONE";
    decisions[d] = (decisions[d] || 0) + 1;
    if ((d === "ALLOW" || d === "LIMIT") && Number.isFinite(Number(r.json.estimatedCost))) {
      charged += Number(r.json.estimatedCost);
    }
    if (Number.isFinite(Number(r.json.spendAfter))) maxSpendAfter = Math.max(maxSpendAfter, Number(r.json.spendAfter));
  }
  charged = Math.round(charged * 1000) / 1000;
  return { n: results.length, errors, decisions, chargedUsd: charged, maxSpendAfter, ceiling, over: charged > ceiling + 0.001 };
}

function render(row) {
  const d = Object.entries(row.decisions).map(([k, v]) => `${k} ${v}`).join(", ");
  return `# Multi-instance budget race

${row.processes}. Ceiling $${row.ceiling} from the server's /api/health.

## Machine

- Date: ${row.hardware.date}
- OS: ${row.hardware.platform}
- CPU: ${row.hardware.cpu}
- Memory: ${row.hardware.memBytes} bytes
- Node: ${row.hardware.node}
- Mode: ${row.mode}

## Command

\`\`\`bash
${row.command}
\`\`\`

## Result

| N | errors | decisions | charged USD (ALLOW+LIMIT estimatedCost) | max spendAfter | ceiling | over ceiling |
|---:|---:|---|---:|---:|---:|---|
| ${row.n} | ${row.errors} | ${d} | ${row.chargedUsd} | ${row.maxSpendAfter} | ${row.ceiling} | ${row.over ? "yes" : "no"} |

Charged USD is the sum of \`estimatedCost\` on ALLOW and LIMIT responses. The Postgres UPDATE allows a charge only when \`spend + cost <= ceiling\`. A yes in the last column means two processes both spent money the ceiling should have stopped.
`;
}

async function localDocker() {
  const docker = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8" });
  if (docker.status !== 0) {
    console.error("docker is not available, race not run");
    process.exitCode = 2;
    return;
  }
  spawnSync("docker", ["rm", "-f", "bs-race-pg"], { stdio: "ignore" });
  const run = spawnSync("docker", [
    "run", "-d", "--name", "bs-race-pg",
    "-e", "POSTGRES_PASSWORD=bleedstop-dev",
    "-e", "POSTGRES_USER=bleedstop",
    "-e", "POSTGRES_DB=bleedstop",
    "-p", "54329:5432",
    "postgres:16-alpine",
  ], { encoding: "utf8" });
  if (run.status !== 0) {
    console.error(run.stderr || run.stdout);
    process.exitCode = 2;
    return;
  }
  const databaseUrl = "postgres://bleedstop:bleedstop-dev@127.0.0.1:54329/bleedstop";
  const ports = [3311, 3312, 3313];
  const kids = [];
  try {
    let ready = false;
    for (let i = 0; i < 40; i++) {
      const ping = spawnSync("docker", ["exec", "bs-race-pg", "pg_isready", "-U", "bleedstop"], { encoding: "utf8" });
      if (ping.status === 0) { ready = true; break; }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!ready) throw new Error("postgres did not become ready");
    for (const port of ports) {
      const child = spawn(process.execPath, ["src/server.js"], { cwd: ROOT, env: childEnv(port, databaseUrl), stdio: "ignore" });
      kids.push(child);
    }
    const bases = [];
    for (const port of ports) bases.push(`http://127.0.0.1:${port}`);
    let health;
    for (const b of bases) health = await waitHealth(b);
    const ceiling = Number(health.unpaidCeilingUsd);
    const result = await runAgainst(bases, ceiling);
    const md = render({
      ...result,
      processes: "3 local Node processes, one Postgres container",
      hardware: machine(),
      mode: "local docker postgres + 3 node processes",
      command: "node deploy/k8s/race.js",
    });
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, md);
    console.log(md);
    if (result.over || result.errors) process.exitCode = 1;
  } finally {
    for (const k of kids) k.kill();
    spawnSync("docker", ["rm", "-f", "bs-race-pg"], { stdio: "ignore" });
  }
}

async function remote(url) {
  const health = await waitHealth(url.replace(/\/$/, ""));
  const ceiling = Number(health.unpaidCeilingUsd);
  const result = await runAgainst([url.replace(/\/$/, "")], ceiling);
  const md = render({
    ...result,
    processes: "one URL in front of the bleedstop Service (deploy/k8s/bleedstop.yaml sets 3 replicas)",
    hardware: machine(),
    mode: `url ${url}`,
    command: `node deploy/k8s/race.js --url ${url} --n ${n}`,
  });
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, md);
  console.log(md);
  if (result.over || result.errors) process.exitCode = 1;
}

if (urlArg) await remote(urlArg);
else await localDocker();
