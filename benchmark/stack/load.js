/**
 * Load generator for an already running stack (compose, k8s, or local).
 *   node benchmark/stack/load.js --url http://127.0.0.1:8080 --n 20000 --c 64
 *   node benchmark/stack/load.js --url ... --seconds 60 --c 32      (time boxed, for rolling restarts)
 * Every request uses a unique actor (no denials expected). Counts non 200 responses and
 * transport errors (connection refused/reset) separately, so a rolling restart that drops
 * requests is visible. Prints one JSON object.
 */
import http from "node:http";
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const url = new URL(opt("url", process.env.BLEEDSTOP_URL || "http://127.0.0.1:3000"));
const N = Number(opt("n", 0));
const SECONDS = Number(opt("seconds", 0));
const C = Number(opt("c", 64));
const TAG = opt("tag", `L${Date.now()}`);
const WARM = Number(opt("warm", 1000));
const keepAlive = opt("keepalive", "1") === "1";
const agent = new http.Agent({ keepAlive, maxSockets: 2048 });

function post(body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const t = performance.now();
    const req = http.request({ host: url.hostname, port: url.port || 80, path: "/decide", method: "POST", agent, timeout: 10000,
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data) } }, (res) => {
      let b = ""; res.on("data", (c) => (b += c));
      res.on("end", () => { let j = {}; try { j = JSON.parse(b); } catch {} resolve({ status: res.statusCode, decision: j.decision, ms: performance.now() - t }); });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (e) => resolve({ status: 0, err: e.code || e.message, ms: performance.now() - t }));
    req.end(data);
  });
}
const body = (k, tag) => ({ actorId: `u-${tag}-${k}`, action: "llm.call", paid: false, estimatedTokens: 1012, signals: { deviceFingerprint: `fp-${tag}-${k}`, email: `u${k}@${tag}.com` } });
const pct = (s, p) => s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];

async function run() {
  if (WARM) { let i = 0; await Promise.all(Array.from({ length: C }, async () => { while (i < WARM) await post(body(i++, TAG + "w")); })); }
  const res = [];
  let i = 0;
  const t0 = performance.now();
  const deadline = SECONDS ? t0 + SECONDS * 1000 : Infinity;
  const timeline = [];
  await Promise.all(Array.from({ length: C }, async () => {
    while ((N && i < N) || (!N && performance.now() < deadline)) {
      const k = i++;
      const r = await post(body(k, TAG));
      res.push(r);
      if (r.status !== 200) timeline.push({ atSec: Number(((performance.now() - t0) / 1000).toFixed(2)), status: r.status, err: r.err });
    }
  }));
  const secs = (performance.now() - t0) / 1000;
  const ms = res.map((r) => r.ms).sort((a, b) => a - b);
  const byStatus = {};
  for (const r of res) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  const errs = {};
  for (const r of res) if (r.err) errs[r.err] = (errs[r.err] || 0) + 1;
  return { url: url.origin, requests: res.length, concurrency: C, seconds: Number(secs.toFixed(2)), rps: Math.round(res.length / secs),
    p50: +pct(ms, 50).toFixed(2), p95: +pct(ms, 95).toFixed(2), p99: +pct(ms, 99).toFixed(2), max: +ms[ms.length - 1].toFixed(2),
    ok200: byStatus[200] || 0, failed: res.length - (byStatus[200] || 0), byStatus, transportErrors: errs,
    denied: res.filter((r) => r.decision === "DENY").length, firstFailures: timeline.slice(0, 20) };
}
console.log(JSON.stringify(await run(), null, 2));
process.exit(0);
