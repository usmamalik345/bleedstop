/**
 * Multi-tenant API keys.
 *
 * Env format (comma-separated):
 *   BLEEDSTOP_API_KEYS=demo-key:local-dev,acme-key:tenant-acme:read
 *   BLEEDSTOP_API_KEYS=sha256:<hex of sha256(key)>:tenant-acme:admin
 *
 * Scope is optional. Missing scope means admin, so older keys keep working.
 * read can call /decide for its own tenant. read cannot change rules or other admin routes.
 * Clients send:  X-API-Key: demo-key
 * If env is empty → auth off (local learning mode).
 */

import { config } from "../config.js";
import crypto from "node:crypto";
import { runWithTenant } from "../tenant/context.js";

/** @returns {{ storedKey: string, tenantId: string, scope: "read" | "admin" }[]} */
export function parseApiKeyEntries(raw = config.apiKeysRaw) {
  const out = [];
  const text = String(raw || "").trim();
  if (!text) return out;
  for (const part of text.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("sha256:")) {
      const bits = trimmed.split(":");
      const hex = bits[1] || "";
      const tenantId = bits[2] || "";
      if (!/^[0-9a-f]{64}$/i.test(hex) || !tenantId) continue;
      const scope = bits[3] === "read" ? "read" : "admin";
      out.push({ storedKey: `sha256:${hex.toLowerCase()}`, tenantId, scope });
      continue;
    }
    const bits = trimmed.split(":");
    if (bits.length < 2) continue;
    let scope = "admin";
    if (bits[bits.length - 1] === "read" || bits[bits.length - 1] === "admin") {
      scope = bits.pop();
    }
    const storedKey = bits.shift().trim();
    const tenantId = bits.join(":").trim();
    if (storedKey && tenantId) out.push({ storedKey, tenantId, scope });
  }
  return out;
}

/** @returns {Map<string, string>} apiKey → tenantId */
export function parseApiKeyMap(raw = config.apiKeysRaw) {
  const map = new Map();
  for (const e of parseApiKeyEntries(raw)) map.set(e.storedKey, e.tenantId);
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
export function resolveApiKeyInfo(apiKey) {
  if (!apiKey) return null;
  const k = String(apiKey).trim();
  const entries = parseApiKeyEntries();
  const digest = crypto.createHash("sha256").update(k).digest();
  let hashed = null;
  for (const entry of entries) {
    if (!entry.storedKey.startsWith("sha256:")) continue;
    const want = Buffer.from(entry.storedKey.slice(7), "hex");
    if (crypto.timingSafeEqual(want, digest)) hashed = entry; // no early exit
  }
  if (hashed) return { tenantId: hashed.tenantId, scope: hashed.scope };
  const plain = entries.find((e) => e.storedKey === k && !e.storedKey.startsWith("sha256:"));
  return plain ? { tenantId: plain.tenantId, scope: plain.scope } : null;
}

export function resolveApiKey(apiKey) {
  return resolveApiKeyInfo(apiKey)?.tenantId ?? null;
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
  const bearer = String(req.headers.authorization || "").startsWith("Bearer ")
    ? String(req.headers.authorization).slice(7).trim()
    : "";
  if (!apiKeysEnabled()) {
    if (process.env.OIDC_ISSUER && bearer) return acceptOidc(req, res, next, bearer);
    return next();
  }

  const path = req.path || "";
  if (path.startsWith("/webhooks/")) return next();
  if (path === "/api/health") return next();

  // Dashboard reads stay open; writes /decide need a key
  // STRICT_READS=1: GET reads also need a key, so tenants cannot read each other's ledger
  const isGet = req.method === "GET" || req.method === "HEAD";
  const publicGet = path === "/metrics" || path.startsWith("/dashboard") || path === "/";
  if (isGet && (process.env.STRICT_READS !== "1" || publicGet)) return next();

  const apiKey = extractApiKey(req);
  const info = resolveApiKeyInfo(apiKey);
  if (!info && process.env.OIDC_ISSUER && bearer) return acceptOidc(req, res, next, bearer);
  if (!info) {
    return res.status(401).json({
      error: "Unauthorized",
      code: "BLEEDSTOP_API_KEY_REQUIRED",
      hint: "Send header X-API-Key matching BLEEDSTOP_API_KEYS",
    });
  }

  req.tenantId = info.tenantId;
  req.apiKey = apiKey;
  req.apiKeyScope = info.scope;
  if (blockReadScope(req, res)) return;
  return runWithTenant(info.tenantId, next);
}

function acceptOidc(req, res, next, bearer) {
  import("./oidc.js").then(({ verifyOidcToken }) => verifyOidcToken(bearer)).then((payload) => {
    const text = String(payload.scope || payload.scp || "");
    req.tenantId = String(payload.tenant_id || payload.tenant || "oidc");
    req.apiKeyScope = text.split(/\s+/).includes("admin") ? "admin" : "read";
    req.oidcSub = payload.sub || "oidc";
    if (blockReadScope(req, res)) return;
    return runWithTenant(req.tenantId, next);
  }).catch(() => {
    res.status(401).json({ error: "Unauthorized", code: "BLEEDSTOP_OIDC" });
  });
}

function blockReadScope(req, res) {
  if (req.apiKeyScope !== "read") return false;
  const isGet = req.method === "GET" || req.method === "HEAD";
  const p = req.path || "";
  const product = p === "/decide" || p === "/agent/precheck" || p.startsWith("/v1/") || p.startsWith("/mcp");
  if (isGet || product) return false;
  res.status(403).json({ error: "read scope cannot change admin state", code: "BLEEDSTOP_SCOPE" });
  return true;
}
