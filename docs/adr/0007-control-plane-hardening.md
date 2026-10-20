# ADR-0007: Harden the control plane itself
**Decision.**
* Strict schema validation of /decide (types, lengths, enums, allowed signal names, safe id charset) before any state is touched; 400 with all errors.
* Token bucket rate limit on /decide per tenant + caller (API key prefix or IP), from tenant policy; 429 + Retry-After. Measured: 247 of 1,000 burst requests accepted at 100 req/s, burst 200 (theoretical max 249).
* API keys map to tenants; keys may be stored as `sha256:<hex>:tenant` so plaintext never sits in env, compared with `timingSafeEqual`. `STRICT_READS=1` requires keys for GET reads (tenant isolation of ledgers).
* RBAC (viewer < operator < admin) on dashboard/admin routes; every non-GET admin mutation is written to the audit log with actor, tenant, status and IP.
* JSON body limit 256 KB, `x-powered-by` off, nosniff, frame deny, no-referrer.
**Consequences.** Rate limits are per process (N instances = N x rate). No mTLS or OIDC yet.
