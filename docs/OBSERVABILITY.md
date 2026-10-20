# Observability

* **Metrics** `GET /metrics` (Prometheus text): `bleedstop_decide_total{decision}`, `bleedstop_decide_latency_ms` histogram (0.5 to 250 ms buckets), `bleedstop_denied_usd_total`, `bleedstop_degraded_redis_total`, reconcile and ghost counters, rule mode changes, Redis syncs.
* **Traces** OpenTelemetry, OTLP/HTTP JSON to `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces` (verified against a local OTLP sink). Spans: `bleedstop.decide` (tenant, action, paid, mode, estimated tokens, decision, cluster, cost, rule ids, shadow rule ids, replay, agent verdict) with children `bleedstop.cluster.resolve`, `bleedstop.rules.evaluate`, `bleedstop.ledger.charge`. Resource: service.name, version, instance id.
* **Logs** `LOG_FORMAT=json`: one line per decision (ts, level, instance, tenant, decision, action, cluster, cost, rule ids, replay, latency).
* **Audit** every rule mode change, runbook action and admin/operator HTTP mutation (`GET /audits`).
* **Cost of tracing** (scale benchmark, 1 instance): 3,786 → 2,519 req/s, p99 34 → 52 ms with export on. Sample in production.
