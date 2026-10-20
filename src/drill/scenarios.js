/**
 * Economic red-team drill (PDF).
 * Runs labelled attacks against THIS app only and reports $ blocked.
 */

import { decide } from "../decision.js";
import { recordVendorUsage } from "../vendorMock.js";
import { reconcile } from "../reconciler.js";
import { resetAll } from "../resetAll.js";
import { roundMoney } from "../utils/money.js";

async function hammer(label, times, body) {
  let allowedCost = 0;
  let denied = 0;
  let challenged = 0;
  let limited = 0;
  let last;
  for (let i = 0; i < times; i++) {
    last = await decide({
      ...body,
      actorId: body.sameActor ? body.actorId : `${body.actorId}-${i}`,
    });
    if (last.decision === "ALLOW" || last.decision === "LIMIT") {
      allowedCost += Number(last.estimatedCost || 0);
    }
    if (last.decision === "DENY") denied += 1;
    if (last.decision === "CHALLENGE") challenged += 1;
    if (last.decision === "LIMIT") limited += 1;
  }
  return { label, attempts: times, allowedCost: roundMoney(allowedCost), denied, challenged, limited, lastDecision: last?.decision };
}

export async function runDrill() {
  await resetAll();
  const scenarios = [];

  scenarios.push(
    await hammer("signup-farm", 30, {
      actorId: "farm",
      sameActor: false,
      action: "signup.create",
      paid: false,
      signals: { deviceFingerprint: "fp-farm", email: "bot@mailinator.com" },
    })
  );

  scenarios.push(
    await hammer("sms-pump", 25, {
      actorId: "pumper",
      sameActor: true,
      action: "sms.send",
      paid: false,
      signals: { deviceFingerprint: "fp-sms" },
    })
  );

  scenarios.push(
    await hammer("llm-abuse", 40, {
      actorId: "llmbot",
      sameActor: true,
      action: "llm.call",
      paid: false,
      signals: { deviceFingerprint: "fp-llm" },
    })
  );

  scenarios.push(
    await hammer("card-test", 4, {
      actorId: "carder",
      sameActor: true,
      action: "payment.attempt",
      paid: false,
      signals: { deviceFingerprint: "fp-card" },
    })
  );

  scenarios.push(
    await hammer("otp-country-mismatch", 1, {
      actorId: "traveler",
      sameActor: true,
      action: "sms.send",
      paid: false,
      phoneCountry: "NG",
      ipCountry: "US",
      signals: { deviceFingerprint: "fp-otp" },
    })
  );

  // Parallel race: 20 unpaid $5 card tests at once. Only one should be charged.
  const race = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      decide({
        actorId: `race-${i}`,
        action: "payment.attempt",
        paid: false,
        signals: { deviceFingerprint: "fp-race" },
      })
    )
  );
  const raceAllows = race.filter((r) => r.decision === "ALLOW").length;
  scenarios.push({
    label: "parallel-ceiling-race",
    attempts: 20,
    allowedCost: raceAllows * 5,
    denied: race.filter((r) => r.decision === "DENY").length,
    raceAllows,
    pass: raceAllows === 1,
  });

  const ghostDecide = await decide({
    actorId: "leaker",
    action: "llm.call",
    paid: true,
    vendorKeyId: "gm-demo-key",
    signals: { deviceFingerprint: "fp-ghost" },
  });
  recordVendorUsage("gm-demo-key", 25);
  const ghost = reconcile({ keyId: "gm-demo-key" });
  scenarios.push({
    label: "leaked-key-ghost",
    appSpend: ghostDecide.estimatedCost,
    ghostDetected: ghost.results?.[0]?.ghostDetected === true,
    keyStatus: ghost.results?.[0]?.keyStatus,
  });

  const blocked = scenarios.reduce((s, row) => {
    if (row.label === "card-test") return s + Math.max(0, 4 * 5 - row.allowedCost);
    if (row.label === "parallel-ceiling-race") return s + Math.max(0, 20 * 5 - row.allowedCost);
    return s;
  }, 0);

  return {
    ok: true,
    note: "Drill ran only inside this process. No outside target.",
    scenarios,
    dollarsBlockedEstimate: roundMoney(blocked),
  };
}
