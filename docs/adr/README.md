# Architecture Decision Records

| ADR | Decision | Status |
|---|---|---|
| [0001](0001-deterministic-hot-path.md) | Deterministic rules on /decide; AI only off the hot path | Accepted |
| [0002](0002-cluster-budgets.md) | Budgets per identity cluster (Union Find), not per account | Accepted |
| [0003](0003-network-signals-nat-safety.md) | IP/ASN are velocity/pool signals, never identity unions | Accepted |
| [0004](0004-redis-atomic-ceiling.md) | Redis Lua check-and-charge + shared identity graph for multi-instance | Accepted |
| [0005](0005-opentelemetry.md) | OpenTelemetry tracing alongside Prometheus, opt-in exporter | Accepted |
| [0006](0006-policy-as-validated-yaml.md) | Per-tenant policy in YAML, validated at boot, fail fast | Accepted |
| [0007](0007-control-plane-hardening.md) | Validate, rate limit and authenticate the control plane itself | Accepted |
| [0008](0008-agent-guard-heuristics.md) | Deterministic agent guard; report held-out numbers, not dev numbers | Accepted |
| [0009](0009-fail-policy.md) | Per-action fail policy and graceful Redis degradation | Accepted |
