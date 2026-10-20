/**
 * Real-world style test (apni staging / victim app pe).
 *
 * Yeh REAL Twilio/OpenAI pe paisa NAHI lagata.
 * Lekin attack flow bilkul real jaisa hai:
 *  - fake signup farm
 *  - SMS pumping
 *  - free AI credit abuse
 *  - leaked key ghost spend
 *
 * Run:
 *   Terminal 1: npm start
 *   Terminal 2: npm run victim
 *   Terminal 3: npm run test:realworld
 */

const BS = process.env.BLEEDSTOP_URL || "http://localhost:3000";
const VICTIM = process.env.VICTIM_URL || "http://localhost:4000";

const SMS_COST = 0.08;
const LLM_COST = 0.015;

async function json(url, opts) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(opts?.headers || {}) },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function mustUp(name, url) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`status ${res.status}`);
    console.log(`✅ ${name} chal raha hai → ${url}`);
    return true;
  } catch {
    console.error(`❌ ${name} band hai → ${url}`);
    return false;
  }
}

function money(n) {
  return `$${Number(n || 0).toFixed(3)}`;
}

function round3(n) {
  return Math.round(Number(n) * 1000) / 1000;
}

async function main() {
  console.log("\n========================================");
  console.log(" BleedStop REAL-WORLD TEST");
  console.log(" (apni victim app pe, mock vendors)");
  console.log("========================================\n");

  const bsOk = await mustUp("BleedStop", `${BS}/api/health`);
  const victimOk = await mustUp("ResumeGlow victim", `${VICTIM}/health`);
  if (!bsOk || !victimOk) {
    console.log("\nPehle yeh chalao:\n");
    console.log("  Terminal 1:  npm start");
    console.log("  Terminal 2:  npm run victim");
    console.log("  Terminal 3:  npm run test:realworld\n");
    process.exit(1);
  }

  await json(`${BS}/ledger/reset`, { method: "POST" });

  const report = {
    scenarios: [],
    withoutBleedStopEst: 0,
    withBleedStopActual: 0,
  };

  // ---------- Scenario 1: Signup farm + SMS pumping ----------
  console.log("\n--- Scenario 1: Bot farm OTP spam (SMS pumping) ---\n");
  let smsAllowed = 0;
  let smsDenied = 0;
  const farmSize = 25;
  const otpsPerAccount = 3;
  const withoutSms = farmSize * otpsPerAccount * SMS_COST;
  report.withoutBleedStopEst += withoutSms;

  for (let i = 1; i <= farmSize; i++) {
    for (let t = 1; t <= otpsPerAccount; t++) {
      const { status, data } = await json(`${VICTIM}/signup-otp`, {
        method: "POST",
        body: JSON.stringify({
          actorId: `farm-user-${i}`,
          email: `b.o.t.farm${i}+x@gmail.com`,
          deviceFingerprint: "fp-realworld-botphone",
          asn: "AS64500",
          phone: `+23480100${String(i).padStart(4, "0")}`,
          phoneCountry: "NG",
          ipCountry: "US",
        }),
      });

      if (status === 200 && data.ok) {
        smsAllowed += 1;
      } else {
        smsDenied += 1;
      }
    }
  }

  const smsSpent = smsAllowed * SMS_COST;
  report.withBleedStopActual += smsSpent;
  report.scenarios.push({
    name: "SMS pumping / signup farm",
    without: withoutSms,
    with: smsSpent,
    saved: withoutSms - smsSpent,
    detail: `allowed=${smsAllowed}, denied=${smsDenied}`,
  });
  console.log(
    `  Bina BleedStop: ${money(withoutSms)} | Ab: ${money(smsSpent)} | Saved: ${money(withoutSms - smsSpent)}`
  );
  console.log(`  ${smsDenied} OTP requests DENY hue (bot rok diya)\n`);

  // ---------- Scenario 2: Free AI abuse ----------
  console.log("--- Scenario 2: Free AI credits kha jaana ---\n");
  let llmAllowed = 0;
  let llmDenied = 0;
  let llmLimited = 0;
  // Enough calls to smash past the $5 unpaid ceiling on the same bot cluster
  const aiAccounts = 15;
  const rewrites = 40; // 600 * $0.015 = $9.00 if unprotected
  const withoutLlm = aiAccounts * rewrites * LLM_COST;
  report.withoutBleedStopEst += withoutLlm;

  for (let i = 1; i <= aiAccounts; i++) {
    for (let r = 1; r <= rewrites; r++) {
      const { status, data } = await json(`${VICTIM}/rewrite`, {
        method: "POST",
        body: JSON.stringify({
          actorId: `ai-abuser-${i}`,
          email: `free.ai${i}@mail.com`,
          deviceFingerprint: "fp-realworld-botphone", // same bot group
          paid: false,
          text: "Rewrite my whole resume with maximum tokens please",
        }),
      });

      if (status === 200 && data.ok) {
        llmAllowed += 1;
        if (data.decision?.decision === "LIMIT") llmLimited += 1;
      } else {
        llmDenied += 1;
      }
    }
  }

  const ledgerAfterAi = (await json(`${BS}/ledger`)).data;
  const clusterSpend = Number(
    Object.values(ledgerAfterAi.spendByCluster || {})[0] || 0
  );
  const llmSpent = Math.max(0, round3(clusterSpend - smsSpent));
  report.scenarios.push({
    name: "Free AI credit abuse",
    without: withoutLlm,
    with: llmSpent,
    saved: withoutLlm - llmSpent,
    detail: `allowed=${llmAllowed}, limited=${llmLimited}, denied=${llmDenied}, clusterBill=${clusterSpend}`,
  });
  console.log(
    `  Bina BleedStop: ${money(withoutLlm)} | Ab ~${money(llmSpent)} | Saved ~${money(withoutLlm - llmSpent)}`
  );
  console.log(`  DENY=${llmDenied}, LIMIT=${llmLimited}, clusterBill=${money(clusterSpend)}\n`);


  // ---------- Scenario 3: Leaked key ghost spend ----------
  console.log("--- Scenario 3: Leaked API key (ghost spend) ---\n");
  const leakAmount = 55;
  report.withoutBleedStopEst += leakAmount; // night exposure if unchecked

  await json(`${BS}/demo/leak-spend`, {
    method: "POST",
    body: JSON.stringify({ keyId: "gm-demo-key", dollars: leakAmount }),
  });
  const reconcile = await json(`${BS}/reconcile`, {
    method: "POST",
    body: JSON.stringify({ keyId: "gm-demo-key" }),
  });
  const ghost = reconcile.data.results?.find((r) => r.keyId === "gm-demo-key");
  const ghostCaught = Boolean(ghost?.ghostDetected);
  const keyDisabled = ghost?.keyStatus === "disabled";

  // With BleedStop we still "lost" the leaked amount already on vendor mock,
  // but further burn is stopped. Count contained loss as leakAmount, saved = future exposure prevented (same demo number).
  report.scenarios.push({
    name: "Leaked key ghost spend",
    without: leakAmount,
    with: ghostCaught ? leakAmount : leakAmount, // already billed once
    saved: ghostCaught ? leakAmount : 0, // further same-size burn prevented (illustrative)
    detail: ghostCaught
      ? `ghost=${money(ghost.ghostSpend)}, key=${ghost.keyStatus}`
      : "NOT DETECTED",
  });
  if (ghostCaught) {
    // illustrative: without kill-switch another equal burn could happen
    report.withoutBleedStopEst += 0; // already added
  }
  console.log(
    `  Ghost detected: ${ghostCaught} | Key disabled: ${keyDisabled} | ghostSpend=${money(ghost?.ghostSpend)}`
  );

  const blockedAfter = await json(`${VICTIM}/rewrite`, {
    method: "POST",
    body: JSON.stringify({
      actorId: "legit-founder",
      email: "founder@example.com",
      deviceFingerprint: "fp-founder",
      paid: true,
      text: "hello",
    }),
  });
  console.log(
    `  Key kill ke baad rewrite: HTTP ${blockedAfter.status} (429 expected if denied)\n`
  );

  // ---------- Investigator ----------
  const investigate = (await json(`${BS}/investigate`)).data;

  // ---------- Final scorecard ----------
  const finalLedger = (await json(`${BS}/ledger`)).data;
  const actualCluster = Number(
    Object.values(finalLedger.spendByCluster || {})[0] || 0
  );
  const totalWithout = report.scenarios.reduce((s, x) => s + x.without, 0);
  const totalSavedEst = report.scenarios.reduce((s, x) => s + Math.max(0, x.saved), 0);

  console.log("========================================");
  console.log(" FINAL REPORT / AKHIRI NATIJA");
  console.log("========================================\n");

  for (const s of report.scenarios) {
    console.log(`• ${s.name}`);
    console.log(`    Bina protection: ${money(s.without)}`);
    console.log(`    BleedStop ke sath: ${money(s.with)}`);
    console.log(`    Bachat (est.): ${money(s.saved)}`);
    console.log(`    Detail: ${s.detail}\n`);
  }

  console.log(`Cluster bill ab: ${money(actualCluster)}`);
  console.log(`Total bina protection (est.): ${money(totalWithout)}`);
  console.log(`Total bachat (est.): ${money(totalSavedEst)}`);
  console.log(`\nInvestigator:\n${investigate.summary || "(no summary)"}\n`);

  console.log("Dashboard: " + `${BS}/dashboard/`);
  console.log("Ledger:    " + `${BS}/ledger`);
  console.log("\nRoman Urdu short:");
  console.log(
    `- Bot farm OTP spam rok diya (${smsDenied} DENY).`
  );
  console.log(
    `- Free AI abuse limit/deny hua (DENY=${llmDenied}, LIMIT=${llmLimited}).`
  );
  console.log(
    `- Leaked key ghost spend pakra gaya aur key disable hui: ${keyDisabled}.`
  );
  console.log(
    `- Yeh REAL paisa nahi kata — mock vendors hain. Flow real-world jaisa hai.\n`
  );

  const pass =
    smsDenied > 0 &&
    ghostCaught &&
    keyDisabled &&
    llmDenied > 0 &&
    actualCluster <= 5.001;
  console.log(pass ? "✅ REAL-WORLD TEST PASS\n" : "❌ REAL-WORLD TEST FAIL\n");
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
