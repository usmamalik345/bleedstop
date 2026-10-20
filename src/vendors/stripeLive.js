/**
 * Optional LIVE Stripe (test mode) for payment-attempt abuse demos.
 * Set STRIPE_SECRET_KEY + STRIPE_PUBLISHABLE_KEY in .env.
 *
 * Portfolio path: create PaymentIntents behind BleedStop payment.attempt guard.
 */

import { config } from "../config.js";
import { recordVendorUsage, getVendorUsage } from "../vendorMock.js";
import { getPrice } from "../priceCatalog.js";

const STRIPE_API = "https://api.stripe.com/v1";

export function isLiveStripeEnabled() {
  return Boolean(
    config.stripeSecretKey?.startsWith("sk_") &&
      config.stripePublishableKey?.startsWith("pk_")
  );
}

export function getStripePublishableKey() {
  return isLiveStripeEnabled() ? config.stripePublishableKey : null;
}

/** Estimated attempt cost from BleedStop price catalog. */
export function estimatedAttemptCostUsd() {
  return getPrice("payment.attempt");
}

async function stripeRequest(path, params = {}) {
  if (!config.stripeSecretKey) {
    throw new Error("STRIPE_SECRET_KEY missing in .env");
  }

  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    body.set(key, String(value));
  }

  const res = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || `Stripe HTTP ${res.status}`);
  }
  return data;
}

/**
 * Create a test PaymentIntent (card-testing style attempt).
 * Does not confirm/charge — safe for abuse-firewall demos.
 */
export async function createTestPaymentIntent({
  amountCents = 50,
  currency = "usd",
  actorId = "unknown",
  metadata = {},
} = {}) {
  if (!isLiveStripeEnabled()) {
    return {
      mode: "offline-stub",
      id: `pi_stub_${Date.now()}`,
      clientSecret: null,
      amountCents,
      currency,
      publishableKey: null,
      costUsd: estimatedAttemptCostUsd(),
    };
  }

  const intent = await stripeRequest("/payment_intents", {
    amount: amountCents,
    currency,
    "automatic_payment_methods[enabled]": "true",
    "metadata[actorId]": actorId,
    "metadata[source]": "bleedstop-protected-saas",
    "metadata[vendorKeyId]": metadata.vendorKeyId || "stripe-live-key",
    ...Object.fromEntries(
      Object.entries(metadata)
        .filter(([k]) => k !== "vendorKeyId")
        .map(([k, v]) => [`metadata[${k}]`, v])
    ),
  });

  return {
    mode: "live-stripe-test",
    id: intent.id,
    clientSecret: intent.client_secret,
    amountCents: intent.amount,
    currency: intent.currency,
    publishableKey: config.stripePublishableKey,
    costUsd: estimatedAttemptCostUsd(),
    status: intent.status,
  };
}

export function publishLiveVendorCost(keyId, costUsd) {
  return recordVendorUsage(keyId, costUsd);
}

export function readPublishedVendorCost(keyId) {
  return getVendorUsage(keyId);
}
