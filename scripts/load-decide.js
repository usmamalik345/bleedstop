const BASE = process.env.BLEEDSTOP_URL || "http://localhost:3000";
const TOTAL = Number(process.env.LOAD_TOTAL || 200);
const CONCURRENCY = Number(process.env.LOAD_CONCURRENCY || 5);

const latencies = [];
let ok = 0;
let fail = 0;

async function one(i) {
  const body = {
    actorId: `load-${i}`,
    action: "llm.call",
    paid: false,
    signals: { deviceFingerprint: `fp-load-${Math.floor(i / 10)}` },
  };
  const start = performance.now();
  try {
    const res = await fetch(`${BASE}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await res.json();
    if (res.ok) ok += 1;
    else fail += 1;
  } catch {
    fail += 1;
  } finally {
    latencies.push(performance.now() - start);
  }
}

async function main() {
  let next = 0;
  async function worker() {
    while (next < TOTAL) {
      const i = next++;
      await one(i);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  latencies.sort((a, b) => a - b);
  const pct = (p) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] || 0;
  const report = {
    total: TOTAL,
    concurrency: CONCURRENCY,
    ok,
    fail,
    p50_ms: Number(pct(0.5).toFixed(2)),
    p95_ms: Number(pct(0.95).toFixed(2)),
    p99_ms: Number(pct(0.99).toFixed(2)),
    target: "PDF target: p95 under about 20ms on the chosen environment",
    pass_20ms: pct(0.95) < 20,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.pass_20ms) process.exitCode = 1;
}

main();
