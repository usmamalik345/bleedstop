/**
 * Stripe webhook verify + ledger sync.
 * Confirms payment_intent.succeeded / failed into BleedStop app ledger + event log.
 */

import crypto from "crypto";
import { config } from "../config.js";
import { addAppKeySpend } from "../keyLedger.js";
import { appendEvent } from "../eventLog.js";
import { roundMoney } from "../utils/money.js";

const DEFAULT_VENDOR_KEY = "stripe-live-key";

export function isStripeWebhookConfigured() {
  return Boolean(config.stripeWebhookSecret?.startsWith("whsec_"));
}

/** Verify Stripe-Signature header (no stripe npm package needed). */
export function verifyStripeSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;

  const parts = signatureHeader.split(",").map((p) => p.split("="));
  const timestamp = parts.find(([k]) => k === "t")?.[1];
  const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!timestamp || signatures.length === 0) return false;

  // Reject replays older than 5 minutes
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > 300) return false;

  const signed = `${timestamp}.${rawBody}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(signed, "utf8")
    .digest("hex");

  return signatures.some((sig) => {
    try {
      return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch {
      return false;
    }
  });
}

/**
 * Handle one Stripe event → update app ledger + event log.
 * Returns summary for HTTP response.
 */
export function handleStripeEvent(event) {
  const type = event?.type;
  const obj = event?.data?.object ?? {};

  if (type === "payment_intent.succeeded") {
    const keyId = obj.metadata?.vendorKeyId || DEFAULT_VENDOR_KEY;
    const actualUsd = roundMoney((obj.amount || 0) / 100);
    const appTotal = addAppKeySpend(keyId, actualUsd);

    const row = appendEvent({
      type: "stripe.payment.succeeded",
      paymentIntentId: obj.id,
      vendorKeyId: keyId,
      amountUsd: actualUsd,
      actorId: obj.metadata?.actorId || null,
      appSpendAfter: appTotal,
      stripeStatus: obj.status,
    });

    return {
      ok: true,
      handled: type,
      paymentIntentId: obj.id,
      amountUsd: actualUsd,
      appSpendAfter: appTotal,
      eventId: row.id,
    };
  }

  if (type === "payment_intent.payment_failed") {
    const row = appendEvent({
      type: "stripe.payment.failed",
      paymentIntentId: obj.id,
      vendorKeyId: obj.metadata?.vendorKeyId || DEFAULT_VENDOR_KEY,
      actorId: obj.metadata?.actorId || null,
      failureMessage: obj.last_payment_error?.message || "unknown",
    });

    return {
      ok: true,
      handled: type,
      paymentIntentId: obj.id,
      eventId: row.id,
    };
  }

  return { ok: true, handled: "ignored", type };
}
