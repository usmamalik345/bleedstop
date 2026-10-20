# Observability

* **Metrics** `GET /metrics` (Prometheus text): `bleedstop_decide_total{decision}`, `bleedstop_decide_latency_ms` histogram (0.5 to 250 ms buckets), `bleedstop_denied_usd_total`, `bleedstop_degraded_redis_total`, reconcile and ghost counters, rule mode changes, Redis syncs.
* **Traces** OpenTelemetry, OTLP/HTTP JSON to `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces` (verified against a local OTLP sink). Spans: `bleedstop.decide` (tenant, action, paid, mode, estimated tokens, decision, cluster, cost, rule ids, shadow rule ids, replay, agent verdict) with children `bleedstop.cluster.resolve`, `bleedstop.rules.evaluate`, `bleedstop.ledger.charge`. Resource: service.name, version, instance id.
* **Logs** `LOG_FORMAT=json`: one line per decision (ts, level, instance, tenant, decision, action, cluster, cost, rule ids, replay, latency).
* **Audit** every rule mode change, runbook action and admin/operator HTTP mutation (`GET /audits`).
* **Cost of tracing** (scale benchmark, 1 instance): 3,786 → 2,519 req/s, p99 34 → 52 ms with export on. Sample in production.

## Grafana Cloud

Grafana's public pricing page says the free tier does not require a credit card (checked 2026-10-20, https://grafana.com/pricing/). This repo does not create that account. If the signup form asks for a card, stop and do not enter one.

Traces leave this process only when you set:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-<region>.grafana.net/otlp
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic <base64 of instanceId:token>
```

The process posts to `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces`. It does not print the header.

Metrics stay on `GET /metrics`. A free local Grafana still scrapes that (see `deploy/observability`). Pushing those metrics to Grafana Cloud needs their Alloy or Agent binary and a remote_write URL from the account you created. This repo does not ship a paid collector.

