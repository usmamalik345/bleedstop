/**
 * Economic red-team drill against BleedStop (your own staging only).
 * Scenarios return ground-truth labels for learning/evals.
 *
 *   npm start
 *   npm run drill
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

const scenarios = [
  {
    id: "signup-farm",
    name: "Signup farm sharing one device",
    async run() {
      await post("/ledger/reset");
      let denies = 0;
      for (let i = 0; i < 30; i++) {
        const r = await post("/decide", {
          actorId: `farm-${i}`,
          action: "sms.send",
          paid: false,
          vendorKeyId: "tw-demo-key",
          signals: { deviceFingerprint: "fp-farm", email: `u${i}@mail.com` },
        });
        if (r.decision === "DENY") denies += 1;
      }
      return { pass: denies > 0, denies, expect: "shared cluster eventually DENY" };
    },
  },
  {
    id: "ghost-key",
    name: "Leaked key ghost spend",
    async run() {
      await post("/ledger/reset");
      await post("/decide", {
        actorId: "user-1",
        action: "llm.call",
        paid: true,
        vendorKeyId: "gm-demo-key",
      });
      await post("/demo/leak-spend", { keyId: "gm-demo-key", dollars: 12 });
      const report = await post("/reconcile", { keyId: "gm-demo-key" });
      const hit = report.results?.[0]?.ghostDetected === true;
      return { pass: hit, report: report.results?.[0], expect: "ghostDetected true" };
    },
  },
  {
    id: "otp-country-shadow",
    name: "OTP country mismatch (shadow rule logs)",
    async run() {
      await post("/ledger/reset");
      const r = await post("/decide", {
        actorId: "traveler-bot",
        action: "sms.send",
        paid: false,
        phoneCountry: "NG",
        ipCountry: "US",
        signals: { deviceFingerprint: "fp-x", email: "x@y.com" },
      });
      const shadow = (r.shadowHits || []).some(
        (h) => h.ruleId === "R-otp-country"
      );
      return { pass: shadow, shadowHits: r.shadowHits, expect: "shadow hit R-otp-country" };
    },
  },
];

async function main() {
  console.log("\nBleedStop drill suite\n");
  let passed = 0;
  for (const s of scenarios) {
    const result = await s.run();
    const ok = result.pass ? "PASS" : "FAIL";
    if (result.pass) passed += 1;
    console.log(`[${ok}] ${s.id} — ${s.name}`);
    console.log(`       expect: ${result.expect}`);
    console.log(`       result: ${JSON.stringify(result)}\n`);
  }
  console.log(`${passed}/${scenarios.length} scenarios passed\n`);
  process.exit(passed === scenarios.length ? 0 : 1);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
