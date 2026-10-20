import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import {
  verifyStripeSignature,
  handleStripeEvent,
} from "../src/vendors/stripeWebhook.js";
import { resetAll } from "../src/resetAll.js";
import { getAppKeySpend } from "../src/keyLedger.js";
import { listEvents } from "../src/eventLog.js";

test("verifyStripeSignature accepts valid v1 signature", () => {
  const secret = "whsec_test_secret";
  const raw = '{"id":"evt_1"}';
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto
    .createHmac("sha256", secret)
    .update(`${t}.${raw}`, "utf8")
    .digest("hex");
  const header = `t=${t},v1=${v1}`;
  assert.equal(verifyStripeSignature(raw, header, secret), true);
});

test("handleStripeEvent records succeeded payment in app ledger", async () => {
  await resetAll();
  const out = handleStripeEvent({
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: "pi_test_1",
        amount: 5,
        status: "succeeded",
        metadata: { actorId: "u1", vendorKeyId: "stripe-live-key" },
      },
    },
  });
  assert.equal(out.amountUsd, 0.05);
  assert.equal(getAppKeySpend("stripe-live-key"), 0.05);
  assert.ok(listEvents().some((e) => e.type === "stripe.payment.succeeded"));
});
