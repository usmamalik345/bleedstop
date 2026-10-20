# ADR-0009: Per-action fail policy and graceful Redis degradation
**Decision.** When BleedStop is unreachable the SDKs (Node and Python) apply: login/signup fail open, SMS/payments/email fail closed, LLM falls back to a local cap (LIMIT, 200 tokens). Inside BleedStop, any Redis error switches the process to local mode instead of erroring (`bleedstop_degraded_redis_total`).
**Consequences.** Measured: killing Redis mid-load produced 0 errors out of 4,000 requests. After degradation, ceilings are per process until restart (cross-instance overspend becomes possible again).
