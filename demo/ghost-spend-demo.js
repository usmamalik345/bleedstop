/**
 * Ghost-spend demo (leaked API key).
 *
 * Story:
 * 1) A real user makes a few AI calls through the app (BleedStop sees them).
 * 2) A hacker finds the key in a public file and burns money DIRECTLY at the vendor.
 * 3) /reconcile compares the two bills and kills the key.
 *
 * Run:
 *   1) npm start
 *   2) npm run demo:ghost
 */

const BASE = process.env.BLEEDSTOP_URL || "http://localhost:3000";
const KEY = "gm-demo-key";

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return res.json();
}

async function get(path) {
  return (await fetch(`${BASE}${path}`)).json();
}

async function main() {
  await post("/ledger/reset");

  console.log("\n1) Normal app traffic (BleedStop sees these AI calls)\n");
  for (let i = 1; i <= 5; i++) {
    const result = await post("/decide", {
      actorId: "real-user-1",
      action: "llm.call",
      paid: true,
      vendorKeyId: KEY,
      signals: { email: "founder@example.com", deviceFingerprint: "fp-founder" },
    });
    console.log(
      `  app call #${i}: ${result.decision}  app+vendor +$${result.estimatedCost}`
    );
  }

  let ledger = await get("/ledger");
  console.log("\n   App ledger for key:", ledger.appSpendByKey);
  console.log("   Vendor bill for key:", ledger.vendorUsageByKey);

  console.log("\n2) Hacker uses leaked key DIRECTLY (skips your app)\n");
  const leak = await post("/demo/leak-spend", { keyId: KEY, dollars: 41 });
  console.log(`  ${leak.message}`);
  console.log(`  Vendor total now: $${leak.vendorTotal}`);

  ledger = await get("/ledger");
  console.log("\n   App ledger (unchanged):", ledger.appSpendByKey);
  console.log("   Vendor bill (jumped):  ", ledger.vendorUsageByKey);

  console.log("\n3) Reconciler runs (accountant check)\n");
  const report = await post("/reconcile", { keyId: KEY });
  console.log(JSON.stringify(report, null, 2));

  const incidents = await get("/incidents");
  console.log("\n4) Incident card:\n");
  console.log(incidents.incidents[0]);

  console.log("\n5) Investigator summary:\n");
  const report = await get("/investigate");
  console.log(report.summary);

  console.log("\n6) Later app call should be blocked (key killed)\n");
  const blocked = await post("/decide", {
    actorId: "real-user-1",
    action: "llm.call",
    paid: true,
    vendorKeyId: KEY,
  });
  console.log(`  ${blocked.decision}: ${blocked.reason}\n`);
}

main().catch((err) => {
  console.error("Is the server running? Start it with: npm start");
  console.error(err.message);
  process.exit(1);
});
