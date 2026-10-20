/**
 * Minimal "your app" starter — copy this into your own project.
 *
 *   npm start          # BleedStop :3000
 *   npm run my-app     # this file :4100
 */

import express from "express";
import { createClient, protectPaidAction } from "../../src/sdk/express.js";

const PORT = Number(process.env.MY_APP_PORT || 4100);
const bleedstop = createClient({
  baseUrl: process.env.BLEEDSTOP_URL || "http://localhost:3000",
  apiKey: process.env.BLEEDSTOP_API_KEY || "",
});

const app = express();
app.use(express.json());

/** Shared helper — attach actor + signals before BleedStop middleware */
function guard(action, vendorKeyId) {
  const attach = (req, _res, next) => {
    req.bleedstop = {
      action,
      actorId: req.body.userId || req.headers["x-user-id"] || req.ip,
      paid: Boolean(req.body.paid),
      vendorKeyId,
      signals: {
        email: req.body.email,
        deviceFingerprint: req.headers["x-device-fingerprint"],
      },
    };
    next();
  };
  return [attach, protectPaidAction(bleedstop, { action })];
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, app: "my-saas-starter", bleedstop: bleedstop.baseUrl });
});

// --- YOUR ROUTES (replace handlers with real Twilio / OpenAI / Stripe) ---

app.post("/otp", ...guard("sms.send", "tw-demo-key"), (req, res) => {
  res.json({
    ok: true,
    message: "OTP would send here — already passed BleedStop",
    decision: req.bleedstopDecision,
  });
});

app.post("/ai", ...guard("llm.call", "oa-live-key"), (req, res) => {
  res.json({
    ok: true,
    reply: `[stub] ${String(req.body.prompt || "").slice(0, 80)}`,
    decision: req.bleedstopDecision,
  });
});

app.post("/pay", ...guard("payment.attempt", "stripe-live-key"), (req, res) => {
  res.json({
    ok: true,
    message: "Create Stripe PaymentIntent here after ALLOW",
    decision: req.bleedstopDecision,
  });
});

app.listen(PORT, () => {
  console.log(`My SaaS starter on http://localhost:${PORT}`);
  console.log(`BleedStop guard: ${bleedstop.baseUrl}`);
});
