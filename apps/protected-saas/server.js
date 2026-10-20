/**
 * Protected SaaS sample — portfolio piece.
 * This is a real Express app structure you can show in interviews.
 *
 * Modes:
 * - OFFLINE (default): BleedStop still protects routes; AI is local stub
 * - LIVE: set OPENAI_API_KEY in .env → real OpenAI calls behind BleedStop
 *
 *   npm start          # BleedStop API
 *   npm run app        # this SaaS on :4000
 *   npm run benchmark  # red-team benchmark against this app
 */

import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import { createClient, protectPaidAction } from "../../src/sdk/express.js";
import {
  isLiveOpenAIEnabled,
  liveChatCompletion,
  publishLiveVendorCost,
} from "../../src/vendors/openaiLive.js";
import {
  isLiveStripeEnabled,
  getStripePublishableKey,
  createTestPaymentIntent,
  publishLiveVendorCost as publishStripeVendorCost,
} from "../../src/vendors/stripeLive.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.APP_PORT || process.env.VICTIM_PORT || 4000);
const VENDOR_KEY = process.env.BLEEDSTOP_VENDOR_KEY_ID || "oa-live-key";
const STRIPE_VENDOR_KEY =
  process.env.BLEEDSTOP_STRIPE_VENDOR_KEY || "stripe-live-key";

const bleedstop = createClient({
  baseUrl: process.env.BLEEDSTOP_URL || "http://localhost:3000",
  apiKey: process.env.BLEEDSTOP_API_KEY || "",
});

const app = express();
app.use(express.json());
// Stripe.js checkout UI (http://localhost:4000/checkout.html)
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    app: "Protected SaaS sample",
    mode: isLiveOpenAIEnabled() ? "live-openai" : "offline-stub",
    stripe: isLiveStripeEnabled() ? "live-stripe-test" : "offline-stub",
    bleedstop: bleedstop.baseUrl,
  });
});

app.get("/", (_req, res) => {
  res.json({
    name: "Protected SaaS sample (portfolio)",
    mode: isLiveOpenAIEnabled() ? "live-openai" : "offline-stub",
    stripe: isLiveStripeEnabled() ? "live-stripe-test" : "offline-stub",
    endpoints: {
      "GET /checkout.html": "Stripe.js checkout UI behind BleedStop",
      "POST /auth/otp": "paid SMS-like action behind BleedStop",
      "POST /ai/rewrite": "LLM action behind BleedStop",
      "GET /payments/config": "Stripe publishable key (test mode)",
      "POST /payments/attempt": "card-test style attempt behind BleedStop",
      "GET /health": "status",
    },
    note: "OPENAI_API_KEY → live AI. STRIPE keys → live test PaymentIntents.",
  });
});

/** Attach BleedStop context for middleware */
function withContext(action) {
  return (req, _res, next) => {
    req.bleedstop = {
      action,
      actorId: req.body.actorId || req.headers["x-actor-id"] || req.ip,
      paid: Boolean(req.body.paid),
      vendorKeyId: action.startsWith("llm")
        ? VENDOR_KEY
        : action.startsWith("payment")
          ? STRIPE_VENDOR_KEY
          : "tw-demo-key",
      phoneCountry: req.body.phoneCountry,
      ipCountry: req.body.ipCountry,
      signals: {
        deviceFingerprint:
          req.body.deviceFingerprint || req.headers["x-device-fingerprint"],
        email: req.body.email,
        asn: req.body.asn,
      },
    };
    next();
  };
}

app.post(
  "/auth/otp",
  withContext("sms.send"),
  protectPaidAction(bleedstop, { action: "sms.send" }),
  async (req, res) => {
    // In production you'd call Twilio Verify here.
    res.json({
      ok: true,
      otpQueued: true,
      phone: req.body.phone || "redacted",
      bleedstop: req.bleedstopDecision,
      provider: "twilio-or-mock (wire your key in production)",
    });
  }
);

app.post(
  "/ai/rewrite",
  withContext("llm.call"),
  protectPaidAction(bleedstop, { action: "llm.call" }),
  async (req, res) => {
    const decision = req.bleedstopDecision;
    const text = String(req.body.text || "Improve this resume bullet.");
    const maxTokens = decision?.limit?.maxTokens || 300;
    const model =
      decision?.action === "llm.call.small"
        ? "gpt-4o-mini"
        : process.env.OPENAI_MODEL || "gpt-4o-mini";

    try {
      if (isLiveOpenAIEnabled()) {
        const live = await liveChatCompletion({
          model,
          maxTokens,
          messages: [
            {
              role: "system",
              content: "Rewrite briefly for a resume. Keep under 80 words.",
            },
            { role: "user", content: text },
          ],
        });

        // Publish observed vendor cost so reconciler can detect drift later
        publishLiveVendorCost(VENDOR_KEY, live.costUsd);

        return res.json({
          ok: true,
          mode: "live-openai",
          rewritten: live.text,
          usage: live.usage,
          costUsd: live.costUsd,
          bleedstop: decision,
        });
      }

      // Offline portfolio mode: still protected by BleedStop, no external spend
      return res.json({
        ok: true,
        mode: "offline-stub",
        rewritten: `[protected stub:${decision.action}] ${text.slice(0, 120)}`,
        bleedstop: decision,
        tip: "Set OPENAI_API_KEY for live OpenAI behind the same middleware.",
      });
    } catch (err) {
      return res.status(502).json({
        error: "Upstream AI failed",
        detail: err.message,
        bleedstop: decision,
      });
    }
  }
);

app.get("/payments/config", (_req, res) => {
  res.json({
    live: isLiveStripeEnabled(),
    publishableKey: getStripePublishableKey(),
    mode: isLiveStripeEnabled() ? "live-stripe-test" : "offline-stub",
  });
});

app.post(
  "/payments/attempt",
  withContext("payment.attempt"),
  protectPaidAction(bleedstop, { action: "payment.attempt" }),
  async (req, res) => {
    const decision = req.bleedstopDecision;
    const actorId =
      req.body.actorId || req.headers["x-actor-id"] || req.ip || "unknown";
    const amountCents = Math.max(
      50,
      Math.min(Number(req.body.amountCents) || 500, 50000)
    );

    try {
      const intent = await createTestPaymentIntent({
        amountCents,
        actorId,
        metadata: {
          email: req.body.email || "",
          vendorKeyId: STRIPE_VENDOR_KEY,
        },
      });

      publishStripeVendorCost(STRIPE_VENDOR_KEY, intent.costUsd);

      return res.json({
        ok: true,
        paymentIntentId: intent.id,
        clientSecret: intent.clientSecret,
        publishableKey: intent.publishableKey,
        amountCents: intent.amountCents,
        mode: intent.mode,
        bleedstop: decision,
        tip:
          intent.mode === "live-stripe-test"
            ? "Use clientSecret + publishableKey with Stripe.js on your frontend."
            : "Add STRIPE keys to .env for live test PaymentIntents.",
      });
    } catch (err) {
      return res.status(502).json({
        error: "Stripe payment intent failed",
        detail: err.message,
        bleedstop: decision,
      });
    }
  }
);

app.listen(PORT, () => {
  console.log(`Protected SaaS on http://localhost:${PORT}`);
  console.log(
    `AI: ${isLiveOpenAIEnabled() ? "LIVE OpenAI" : "OFFLINE stub"} | Stripe: ${isLiveStripeEnabled() ? "LIVE test" : "OFFLINE stub"} | BleedStop: ${bleedstop.baseUrl}`
  );
});
