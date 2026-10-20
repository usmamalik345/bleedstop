/**
 * Multi-tenant API keys.
 *
 * Env format (comma-separated):
 *   BLEEDSTOP_API_KEYS=demo-key:local-dev,acme-key:tenant-acme
 *
 * Clients send:  X-API-Key: demo-key
 * If env is empty → auth off (local learning mode).
 *
 * When keys are on:
 * - GET (dashboard reads) stay open
 * - POST/PUT/PATCH/DELETE need a valid key (except Stripe webhook)
 */

import { config } from "../config.js";
import crypto from "node:crypto";
import { runWithTenant } from "../tenant/context.js";

/** @returns {Map<string, string>} apiKey → tenantId */
export function parseApiKeyMap(raw = config.apiKeysRaw) {
  const map = new Map();
  const text = String(raw || "").trim();
  if (!text) return map;
  for (const part of text.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("sha256:")) {
      const [, hex, tenant] = trimmed.split(":");
      if (/^[0-9a-f]{64}$/i.test(hex || "") && tenant) map.set(`sha256:${hex.toLowerCase()}`, tenant);
      continue;
    }
    const colon = trimmed.indexOf(":");
    if (colon <= 0) continue;
    const key = trimmed.slice(0, colon).trim();
    const tenantId = trimmed.slice(colon + 1).trim();
    if (key && tenantId) map.set(key, tenantId);
  }
  return map;
}

export function apiKeysEnabled() {
  return parseApiKeyMap().size > 0;
}

/**
 * Entries may be stored hashed so plaintext keys never sit in env/config:
 *   BLEEDSTOP_API_KEYS=sha256:<hex of sha256(key)>:tenant-acme
 * Hashed entries are compared with crypto.timingSafeEqual.
 */
export function resolveApiKey(apiKey) {
  if (!apiKey) return null;
  const k = String(apiKey).trim();
  const map = parseApiKeyMap();
  const digest = crypto.createHash("sha256").update(k).digest();
  let found = null;
  for (const [entry, tenant] of map) {
    if (!entry.startsWith("sha256:")) continue;
    const want = Buffer.from(entry.slice(7), "hex");
    if (crypto.timingSafeEqual(want, digest)) found = tenant; // no early exit
  }
  if (found) return found;
  return map.has(k) && !k.startsWith("sha256:") ? map.get(k) : null;
}

function extractApiKey(req) {
  return (
    req.headers["x-api-key"] ||
    (String(req.headers.authorization || "").startsWith("Bearer ")
      ? String(req.headers.authorization).slice(7)
      : "") ||
    ""
  );
}

/**
 * Express middleware: require X-API-Key on mutating routes when keys configured.
 */
export function requireApiKey(req, res, next) {
  if (!apiKeysEnabled()) return next();

  const path = req.path || "";
  if (path.startsWith("/webhooks/")) return next();
  if (path === "/api/health") return next();

  // Dashboard reads stay open; writes /decide need a key
  // STRICT_READS=1: GET reads also need a key, so tenants cannot read each other's ledger
  const isGet = req.method === "GET" || req.method === "HEAD";
  const publicGet = path === "/metrics" || path.startsWith("/dashboard") || path === "/";
  if (isGet && (process.env.STRICT_READS !== "1" || publicGet)) return next();

  const apiKey = extractApiKey(req);
  const tenantId = resolveApiKey(apiKey);
  if (!tenantId) {
    return res.status(401).json({
      error: "Unauthorized",
      code: "BLEEDSTOP_API_KEY_REQUIRED",
      hint: "Send header X-API-Key matching BLEEDSTOP_API_KEYS",
    });
  }

  req.tenantId = tenantId;
  req.apiKey = apiKey;
  return runWithTenant(tenantId, next);
}
