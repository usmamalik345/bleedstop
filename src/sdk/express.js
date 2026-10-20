/**
 * BleedStop Express middleware — drop into a REAL Node/Express app.
 *
 * Example:
 *   import { fallbackDecision } from "../failPolicy.js";
 *   const bleedstop = createClient({ baseUrl: process.env.BLEEDSTOP_URL });
 *   app.post("/otp", protectPaidAction(bleedstop, { action: "sms.send" }), sendOtp);
 */

import { fallbackDecision } from "../failPolicy.js";

export function createClient({
  baseUrl = process.env.BLEEDSTOP_URL || "http://localhost:3000",
  apiKey = process.env.BLEEDSTOP_API_KEY || "",
  timeoutMs = 2500,
} = {}) {
  function headers() {
    const h = { "Content-Type": "application/json" };
    if (apiKey) h["X-API-Key"] = apiKey;
    return h;
  }

  async function decide(body) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl}/decide`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "BleedStop decide failed");
      return data;
    } finally {
      clearTimeout(t);
    }
  }

  async function guarded(request, fn) {
    const decision = await decide({ ...request, mode: "auto" });
    if (decision.decision === "DENY") {
      return { ok: false, decision, result: null };
    }
    const result = await fn(decision);
    return { ok: true, decision, result };
  }

  async function reconcile(body = {}) {
    const res = await fetch(`${baseUrl}/reconcile`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });
    return res.json();
  }

  return { decide, guarded, reconcile, baseUrl, apiKey: Boolean(apiKey) };
}

/**
 * Express middleware: block expensive routes before your handler runs.
 *
 * Reads from req:
 *  - req.bleedstop.actorId (or req.body.actorId / req.ip)
 *  - req.bleedstop.signals
 *  - req.bleedstop.paid
 *  - req.bleedstop.vendorKeyId
 */
export function protectPaidAction(client, { action, getContext } = {}) {
  if (!action) throw new Error("protectPaidAction requires action");

  return async function bleedstopProtect(req, res, next) {
    try {
      const ctx =
        typeof getContext === "function"
          ? getContext(req)
          : req.bleedstop || {};

      const actorId =
        ctx.actorId || req.body?.actorId || req.headers["x-actor-id"] || req.ip;
      const decision = await client.decide({
        actorId,
        action: ctx.action || action,
        paid: Boolean(ctx.paid ?? req.body?.paid),
        vendorKeyId: ctx.vendorKeyId || req.body?.vendorKeyId,
        phoneCountry: ctx.phoneCountry || req.body?.phoneCountry,
        ipCountry: ctx.ipCountry || req.body?.ipCountry,
        signals: ctx.signals || {
          deviceFingerprint:
            req.body?.deviceFingerprint || req.headers["x-device-fingerprint"],
          email: req.body?.email,
          asn: req.body?.asn,
        },
      });

      req.bleedstopDecision = decision;

      if (decision.decision === "DENY") {
        return res.status(429).json({
          error: "BleedStop denied this paid action",
          code: "BLEEDSTOP_DENY",
          decision,
        });
      }

      // LIMIT is allowed through — handler should respect decision.limit / decision.action
      return next();
    } catch (err) {
      const fallback = fallbackDecision(action);
      req.bleedstopDecision = { ...fallback, detail: err.message };
      if (fallback.decision === "DENY") {
        return res.status(503).json({
          error: "BleedStop unavailable",
          code: "BLEEDSTOP_FAIL_CLOSED",
          decision: req.bleedstopDecision,
        });
      }
      return next();
    }
  };
}
