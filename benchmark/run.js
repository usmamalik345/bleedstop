/**
 * Portfolio red-team benchmark against the protected SaaS app.
 * This is NOT a toy click demo — it measures $ exposure with/without controls.
 *
 *   npm start
 *   npm run app
 *   npm run benchmark
 */

const BS = process.env.BLEEDSTOP_URL || "http://localhost:3000";
const APP = process.env.APP_URL || "http://localhost:4000";
const SMS = 0.08;
const LLM = 0.015;
const PAYMENT = 0.05;

async function req(url, opts) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

async function up(name, url) {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(String(r.status));
    console.log(`OK  ${name} → ${url}`);
    return true;
  } catch {
    console.error(`DOWN ${name} → ${url}`);
    return false;
  }
}

const money = (n) => `$${Number(n || 0).toFixed(3)}`;

async function main() {
  console.log("\n=== BleedStop Portfolio Benchmark ===\n");

  if (!(await up("BleedStop", `${BS}/api/health`)) || !(await up("SaaS app", `${APP}/health`))) {
    console.log("\nStart first:\n  npm start\n  npm run app\n  npm run benchmark\n");
    process.exit(1);
  }

  await req(`${BS}/ledger/reset`, { method: "POST" });
  const health = (await req(`${BS}/api/health`)).data;
  const appHealth = (await req(`${APP}/health`)).data;

  const rows = [];

  // 1) SMS farm
  let smsAllow = 0;
  let smsDeny = 0;
  const farm = 25;
  const otps = 3;
  const smsWithout = farm * otps * SMS;
  for (let i = 1; i <= farm; i++) {
    for (let t = 0; t < otps; t++) {
      const r = await req(`${APP}/auth/otp`, {
        method: "POST",
        body: JSON.stringify({
          actorId: `farm-${i}`,
          email: `bot.farm${i}@gmail.com`,
          deviceFingerprint: "fp-portfolio-bot",
          phoneCountry: "NG",
          ipCountry: "US",
          phone: `+1000000${i}`,
        }),
      });
      if (r.status === 200) smsAllow += 1;
      else smsDeny += 1;
    }
  }
  const smsWith = smsAllow * SMS;
  rows.push({
    name: "OTP / SMS pumping",
    without: smsWithout,
    with: smsWith,
    saved: smsWithout - smsWith,
    extra: `allow=${smsAllow} deny=${smsDeny}`,
  });

  // 2) AI abuse
  let aiAllow = 0;
  let aiDeny = 0;
  let aiLimit = 0;
  const accounts = 15;
  const rewrites = 40;
  const aiWithout = accounts * rewrites * LLM;
  for (let i = 1; i <= accounts; i++) {
    for (let r = 0; r < rewrites; r++) {
      const out = await req(`${APP}/ai/rewrite`, {
        method: "POST",
        body: JSON.stringify({
          actorId: `ai-${i}`,
          email: `ai${i}@mail.com`,
          deviceFingerprint: "fp-portfolio-bot",
          paid: false,
          text: "Rewrite my resume with max detail",
        }),
      });
      if (out.status === 200) {
        aiAllow += 1;
        if (out.data.bleedstop?.decision === "LIMIT") aiLimit += 1;
      } else aiDeny += 1;
    }
  }
  const ledger = (await req(`${BS}/ledger`)).data;
  const clusterBill = Number(Object.values(ledger.spendByCluster || {})[0] || 0);
  const aiWith = Math.max(0, clusterBill - smsWith);
  rows.push({
    name: "Free AI credit abuse",
    without: aiWithout,
    with: aiWith,
    saved: aiWithout - aiWith,
    extra: `allow=${aiAllow} limit=${aiLimit} deny=${aiDeny} cluster=${clusterBill}`,
  });

  // 3) Card testing / payment attempts
  let payAllow = 0;
  let payDeny = 0;
  const cardBots = 20;
  const attempts = 4;
  const payWithout = cardBots * attempts * PAYMENT;
  for (let i = 1; i <= cardBots; i++) {
    for (let t = 0; t < attempts; t++) {
      const r = await req(`${APP}/payments/attempt`, {
        method: "POST",
        body: JSON.stringify({
          actorId: `card-${i}`,
          email: `card${i}@tempmail.com`,
          deviceFingerprint: "fp-portfolio-bot",
          paid: false,
          amountCents: 50,
        }),
      });
      if (r.status === 200) payAllow += 1;
      else payDeny += 1;
    }
  }
  const payWith = payAllow * PAYMENT;
  rows.push({
    name: "Card testing / payment attempts",
    without: payWithout,
    with: payWith,
    saved: payWithout - payWith,
    extra: `allow=${payAllow} deny=${payDeny}`,
  });

  // 4) Leaked key
  const leak = 55;
  await req(`${BS}/keys/gm-demo-key/enable`, { method: "POST" });
  await req(`${BS}/demo/leak-spend`, {
    method: "POST",
    body: JSON.stringify({ keyId: "gm-demo-key", dollars: leak }),
  });
  const recon = await req(`${BS}/reconcile`, {
    method: "POST",
    body: JSON.stringify({ keyId: "gm-demo-key" }),
  });
  const g = recon.data.results?.find((x) => x.keyId === "gm-demo-key");
  rows.push({
    name: "Leaked key ghost spend",
    without: leak,
    with: leak,
    saved: g?.ghostDetected ? leak : 0,
    extra: `ghost=${g?.ghostSpend} key=${g?.keyStatus}`,
  });

  const saved = rows.reduce((s, r) => s + Math.max(0, r.saved), 0);
  const without = rows.reduce((s, r) => s + r.without, 0);

  console.log(`App mode: ${appHealth.mode}`);
  console.log(`Storage:  ${health.storage || "memory"}\n`);
  console.log("| Scenario | Without | With | Saved |");
  console.log("|---|---:|---:|---:|");
  for (const r of rows) {
    console.log(
      `| ${r.name} | ${money(r.without)} | ${money(r.with)} | ${money(r.saved)} |`
    );
    console.log(`  ${r.extra}`);
  }
  console.log(`\nTotal without: ${money(without)}`);
  console.log(`Total saved:   ${money(saved)}`);
  console.log(`\nDashboard: ${BS}/dashboard/`);
  console.log("Put this table in your portfolio README.\n");

  const pass = smsDeny > 0 && aiDeny > 0 && g?.keyStatus === "disabled";
  console.log(pass ? "BENCHMARK PASS" : "BENCHMARK FAIL");
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
