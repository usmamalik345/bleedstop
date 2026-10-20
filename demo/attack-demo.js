/**
 * Fake bot farm demo — now with MANY accounts.
 *
 * Old cheat: make a new account when one hits the $5 limit.
 * New defense: same device fingerprint → same cluster → same $5 bill.
 *
 * Run:
 *   1) npm start   (in one terminal)
 *   2) npm run demo
 */

const BASE = process.env.BLEEDSTOP_URL || "http://localhost:3000";

async function ask(account, action) {
  const res = await fetch(`${BASE}/decide`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      actorId: account.actorId,
      action,
      paid: false,
      signals: {
        deviceFingerprint: account.deviceFingerprint,
        email: account.email,
        asn: account.asn,
      },
    }),
  });
  return res.json();
}

async function main() {
  await fetch(`${BASE}/ledger/reset`, { method: "POST" });

  // Different account ids + slightly different emails...
  // but SAME device fingerprint → one bot group.
  const accounts = [
    {
      actorId: "acc-1",
      email: "b.o.t.one+a@gmail.com",
      deviceFingerprint: "fp-evil-phone",
      asn: "AS64500",
    },
    {
      actorId: "acc-2",
      email: "botone+b@gmail.com", // same mailbox after normalize
      deviceFingerprint: "fp-evil-phone",
      asn: "AS64500",
    },
    {
      actorId: "acc-3",
      email: "other.bot@yahoo.com",
      deviceFingerprint: "fp-evil-phone", // still same device
      asn: "AS64501",
    },
  ];

  console.log("\nAttack demo: 3 fake accounts try to dodge the $5 limit");
  console.log("They share deviceFingerprint = fp-evil-phone\n");

  let denyCount = 0;

  for (const account of accounts) {
    console.log(`--- ${account.actorId} (${account.email}) ---`);
    for (let i = 1; i <= 40; i++) {
      const result = await ask(account, "sms.send");
      console.log(
        `#${String(i).padStart(2, "0")}  ${result.decision}  cluster=${result.clusterId}  bill=$${
          result.spendAfter ?? result.spendBefore
        }  — ${result.reason}`
      );

      if (result.decision === "DENY") {
        denyCount += 1;
        console.log(`(account ${account.actorId} blocked — shared cluster bill is full)\n`);
        break;
      }
    }
  }

  const ledger = await (await fetch(`${BASE}/ledger`)).json();
  console.log("Final ledger:", JSON.stringify(ledger, null, 2));

  if (denyCount > 0 && Object.keys(ledger.spendByCluster).length === 1) {
    console.log("\nSuccess: many accounts, ONE cluster bill, bleed capped.\n");
  }
}

main().catch((err) => {
  console.error("Is the server running? Start it with: npm start");
  console.error(err.message);
  process.exit(1);
});
