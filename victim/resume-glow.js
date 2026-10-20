/**
 * Victim app: "ResumeGlow" — vibe-coded style AI + OTP demo.
 * Deliberately asks BleedStop before spending.
 *
 * Run (with BleedStop already up):
 *   node victim/resume-glow.js
 */

import express from "express";
import { createClient } from "../src/sdk/client.js";

const PORT = Number(process.env.VICTIM_PORT || 4000);
const bs = createClient({
  baseUrl: process.env.BLEEDSTOP_URL || "http://localhost:3000",
});

const app = express();
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    app: "ResumeGlow (victim demo)",
    endpoints: ["POST /signup-otp", "POST /rewrite", "GET /health"],
  });
});

app.get("/health", (_req, res) => res.json({ ok: true }));

/** Fake OTP send — costs SMS money */
app.post("/signup-otp", async (req, res) => {
  const {
    actorId = "anon",
    email,
    deviceFingerprint,
    asn,
    phoneCountry,
    ipCountry,
  } = req.body ?? {};

  const { ok, decision, result } = await bs.guarded(
    {
      actorId,
      action: "sms.send",
      paid: false,
      vendorKeyId: "tw-demo-key",
      phoneCountry,
      ipCountry,
      signals: { email, deviceFingerprint, asn },
    },
    async () => ({ otpSent: true, to: req.body?.phone || "hidden" })
  );

  if (!ok) {
    return res.status(429).json({
      error: "BleedStop denied OTP send",
      decision,
    });
  }
  res.json({ ok: true, decision, result });
});

/** Fake AI rewrite — costs LLM money */
app.post("/rewrite", async (req, res) => {
  const {
    actorId = "anon",
    email,
    deviceFingerprint,
    paid = false,
    text = "hello",
  } = req.body ?? {};

  const { ok, decision, result } = await bs.guarded(
    {
      actorId,
      action: "llm.call",
      paid: Boolean(paid),
      vendorKeyId: "gm-demo-key",
      signals: { email, deviceFingerprint },
    },
    async (d) => ({
      rewritten: `[${d.action}] ${String(text).slice(0, 80)}...`,
      usedAction: d.action,
    })
  );

  if (!ok) {
    return res.status(429).json({
      error: "BleedStop denied AI rewrite",
      decision,
    });
  }
  res.json({ ok: true, decision, result });
});

app.listen(PORT, () => {
  console.log(`ResumeGlow victim app on http://localhost:${PORT}`);
});
