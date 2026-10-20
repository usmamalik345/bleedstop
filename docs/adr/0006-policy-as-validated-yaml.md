# ADR-0006: Per-tenant policy in YAML, validated at boot
**Decision.** `POLICY_FILE` YAML with `defaults` and `tenants.<id>` overrides for budgets, caps, signal thresholds, agent guard and /decide rate limits. Env vars provide defaults. Every key is type and range checked; unknown keys, bad tenant ids or out-of-range values abort startup with all errors listed. Effective policy per tenant at `GET /policy` (admin role).
**Consequences.** A typo cannot silently run with a wrong ceiling. Changing policy needs a restart (no hot reload yet).
