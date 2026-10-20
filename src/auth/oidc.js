/**
 * Optional OIDC login for the admin API.
 * Set OIDC_ISSUER (and OIDC_AUDIENCE if the token has an aud claim).
 * This is a generic OpenID Connect check. It is not SAML.
 * A local Keycloak container is in deploy/keycloak/docker-compose.yml.
 */
import crypto from "node:crypto";

function readJson(part) {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

export function verifyRs256(token, jwk, { issuer, audience, now = Date.now() } = {}) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const [h, p, s] = parts;
  const header = readJson(h);
  if (header.alg !== "RS256") throw new Error("only RS256 is accepted");
  const payload = readJson(p);
  if (issuer && payload.iss !== issuer) throw new Error("issuer mismatch");
  if (audience) {
    const aud = payload.aud;
    const ok = Array.isArray(aud) ? aud.includes(audience) : aud === audience;
    if (!ok) throw new Error("audience mismatch");
  }
  if (payload.exp && payload.exp * 1000 < now) throw new Error("token expired");
  const key = crypto.createPublicKey({ key: jwk, format: "jwk" });
  const good = crypto.verify("RSA-SHA256", Buffer.from(`${h}.${p}`), key, Buffer.from(s, "base64url"));
  if (!good) throw new Error("bad signature");
  return payload;
}

let cache = null;

export function resetOidcCache() { cache = null; }

export async function verifyOidcToken(token) {
  const issuer = String(process.env.OIDC_ISSUER || "").replace(/\/$/, "");
  if (!issuer) throw new Error("OIDC_ISSUER is not set");
  if (!cache || cache.issuer !== issuer || Date.now() > cache.exp) {
    const disc = await fetch(`${issuer}/.well-known/openid-configuration`).then((r) => {
      if (!r.ok) throw new Error(`discovery HTTP ${r.status}`);
      return r.json();
    });
    const jwks = await fetch(disc.jwks_uri).then((r) => {
      if (!r.ok) throw new Error(`jwks HTTP ${r.status}`);
      return r.json();
    });
    cache = { issuer: disc.issuer || issuer, keys: jwks.keys || [], exp: Date.now() + 60_000 };
  }
  const header = readJson(String(token).split(".")[0]);
  const jwk = cache.keys.find((k) => k.kid === header.kid) || cache.keys[0];
  if (!jwk) throw new Error("no signing key");
  return verifyRs256(token, jwk, { issuer: cache.issuer, audience: process.env.OIDC_AUDIENCE || "" });
}
