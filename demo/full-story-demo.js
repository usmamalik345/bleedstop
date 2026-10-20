/**
 * Full story demo (ResumeGlow Saturday night):
 * 1) Bot farm signups + SMS
 * 2) Free AI abuse
 * 3) Leaked key ghost spend
 * 4) Reconcile + investigator report
 *
 *   npm start
 *   npm run demo:full
 */

const BASE = process.env.BLEEDSTOP_URL || "http://localhost:3000";

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
  console.log("\n=== BleedStop full story ===\n");

  console.log("1) Bot farm: 8 accounts, same device, SMS + AI\n");
  for (let i = 1; i <= 8; i++) {
    const actorId = `bot-${i}`;
    const signals = {
      deviceFingerprint: "fp-evil-phone",
      email: `b.o.t${i}+x@gmail.com`,
      asn: "AS64500",
    };
    for (let s = 0; s < 5; s++) {
      const sms = await post("/decide", {
        actorId,
        action: "sms.send",
        paid: false,
        vendorKeyId: "tw-demo-key",
        phoneCountry: "NG",
        ipCountry: "US",
        signals,
      });
      if (sms.decision === "DENY") {
        console.log(`  ${actorId} SMS DENY — ${sms.reason}`);
        break;
      }
    }
    const llm = await post("/decide", {
      actorId,
      action: "llm.call",
      paid: false,
      vendorKeyId: "gm-demo-key",
      signals,
    });
    console.log(
      `  ${actorId} llm=${llm.decision} cluster=${llm.clusterId} bill=${llm.spendAfter ?? llm.spendBefore}`
    );
  }

  console.log("\n2) Leaked Gemini key used outside the app (+$40)\n");
  const leak = await post("/demo/leak-spend", { keyId: "gm-demo-key", dollars: 40 });
  console.log(`  vendor total: $${leak.vendorTotal}`);

  console.log("\n3) Reconcile\n");
  console.log(await post("/reconcile", {}));

  console.log("\n4) Investigator report\n");
  const report = await get("/investigate");
  console.log(report.summary);
  console.log("\nSuggested rules:", report.suggestedRules.map((p) => p.title));

  console.log("\n5) Morning digest\n");
  console.log(await get("/report/morning"));

  console.log("\nDashboard: http://localhost:3000/dashboard/\n");
}

main().catch((err) => {
  console.error("Start server first: npm start");
  console.error(err.message);
  process.exit(1);
});
