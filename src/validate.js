/**
 * Strict input validation for POST /decide (security hardening, ADR-0007).
 * Rejects unknown types, oversized strings and unknown modes before any state is touched.
 */
import { listPrices } from "./priceCatalog.js";

const ID = /^[\w.@:+\-/]{1,200}$/;
const MODES = new Set(["auto", "reserve", "commit"]);
const SIGNALS = new Set(["deviceFingerprint", "email", "asn", "ip", "honeypot"]);

function str(v, max) { return typeof v === "string" && v.length > 0 && v.length <= max; }

/** @returns {{ ok: true, value: object } | { ok: false, errors: string[] }} */
export function validateDecide(body) {
  const e = [];
  if (body == null || typeof body !== "object" || Array.isArray(body)) return { ok: false, errors: ["body must be a JSON object"] };
  const prices = listPrices();
  if (!str(body.actorId, 200) || !ID.test(body.actorId)) e.push("actorId: required, 1-200 chars [A-Za-z0-9_.@:+-/]");
  if (!str(body.action, 64) || !prices[body.action]) e.push(`action: must be one of ${Object.keys(prices).join(", ")}`);
  if (body.paid != null && typeof body.paid !== "boolean") e.push("paid: boolean");
  if (body.mode != null && !MODES.has(body.mode)) e.push("mode: auto|reserve|commit");
  if (body.idempotencyKey != null && (!str(body.idempotencyKey, 128) || !ID.test(body.idempotencyKey))) e.push("idempotencyKey: 1-128 safe chars");
  if (body.vendorKeyId != null && (!str(body.vendorKeyId, 64) || !ID.test(body.vendorKeyId))) e.push("vendorKeyId: 1-64 safe chars");
  for (const f of ["phoneCountry", "ipCountry"]) if (body[f] != null && !/^[A-Z]{2}$/.test(body[f])) e.push(`${f}: ISO-3166 alpha-2`);
  if (body.estimatedTokens != null && !(Number.isInteger(body.estimatedTokens) && body.estimatedTokens >= 0 && body.estimatedTokens <= 50_000_000)) e.push("estimatedTokens: integer 0..50,000,000");
  if (body.actualCost != null && !(typeof body.actualCost === "number" && body.actualCost >= 0 && body.actualCost <= 1e6)) e.push("actualCost: number 0..1e6");
  if (body.signals != null) {
    if (typeof body.signals !== "object" || Array.isArray(body.signals)) e.push("signals: object");
    else for (const [k, v] of Object.entries(body.signals)) {
      if (!SIGNALS.has(k)) e.push(`signals.${k}: unknown signal`);
      else if (v != null && !(typeof v === "string" || typeof v === "number" || typeof v === "boolean")) e.push(`signals.${k}: string`);
      else if (v != null && String(v).length > 256) e.push(`signals.${k}: max 256 chars`);
    }
  }
  if (body.agent != null) {
    const a = body.agent;
    if (typeof a !== "object" || Array.isArray(a)) e.push("agent: object");
    else {
      if (a.text != null && (typeof a.text !== "string" || a.text.length > 200_000)) e.push("agent.text: string <= 200k");
      if (a.toolName != null && !str(a.toolName, 64)) e.push("agent.toolName: string <= 64");
      if (a.sessionId != null && !str(a.sessionId, 128)) e.push("agent.sessionId: string <= 128");
      if (a.depth != null && !(Number.isInteger(a.depth) && a.depth >= 0 && a.depth <= 1000)) e.push("agent.depth: int");
    }
  }
  return e.length ? { ok: false, errors: e } : { ok: true, value: body };
}
