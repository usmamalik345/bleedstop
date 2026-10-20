# BleedStop attack suite results

Method: local box, Node v20.19.2, BleedStop in memory mode (no Postgres/Redis, RAG off), deterministic mock LLM upstream (tokens = ceil(chars/4)). Price assumption: $2.50 per 1M input tokens, $10 per 1M output tokens (mock output = min(max_tokens, 200) tokens). Each scenario sent once directly to the upstream and once through BleedStop (SDK guarded() in a tiny gateway), with full state reset between. 3 runs, medians reported. 'Blocked' = DENY or CHALLENGE. 'Calls prevented' = upstream calls avoided vs direct.


## before-original-code (3 runs, 2026-10-19T18:47:12.832Z UTC)

| Scenario | Requests | Blocked % | Limited % | Upstream calls prevented % | Upstream $ direct | Upstream $ protected | $ saved per 1,000 calls |
|---|---:|---:|---:|---:|---:|---:|---:|
| normal_baseline (normal) | 1000 | 0.0 | 0.0 | 0.0 | 3.25 | 3.25 | 0.00 |
| free_tier_farm_shared_device | 2000 | 83.1 | 0.3 | 83.1 | 6.50 | 1.10 | 2.70 |
| free_tier_farm_rotating_all_signals | 2000 | 0.0 | 0.0 | 0.0 | 6.50 | 6.50 | 0.00 |
| token_flood_400k_char_prompts | 200 | 0.0 | 0.0 | 0.0 | 50.40 | 50.40 | 0.00 |
| retry_storm_no_idempotency | 1000 | 66.2 | 0.7 | 66.2 | 3.25 | 1.10 | 2.15 |
| retry_storm_same_idempotency_key | 1000 | 0.0 | 0.0 | 0.0 | 3.25 | 3.25 | 0.00 |

End to end latency, 1,000 sequential requests (gateway + mock upstream, ms): direct p50 1.09 / p95 1.82; protected p50 2.18 / p95 3.15; added p50 1.07 / p95 1.27.
Throughput, 3,000 requests at concurrency 32: direct 905 req/s, protected 617 req/s.


## after-enterprise-patch (3 runs, 2026-10-19T18:52:59.022Z UTC)

| Scenario | Requests | Blocked % | Limited % | Upstream calls prevented % | Upstream $ direct | Upstream $ protected | $ saved per 1,000 calls |
|---|---:|---:|---:|---:|---:|---:|---:|
| normal_baseline (normal) | 1000 | 0.0 | 0.0 | 0.0 | 3.25 | 3.25 | 0.00 |
| free_tier_farm_shared_device | 2000 | 97.0 | 0.0 | 97.0 | 6.50 | 0.20 | 3.15 |
| free_tier_farm_rotating_all_signals | 2000 | 0.0 | 0.0 | 0.0 | 6.50 | 6.50 | 0.00 |
| token_flood_400k_char_prompts | 200 | 100.0 | 0.0 | 100.0 | 50.40 | 0.00 | 252.00 |
| retry_storm_no_idempotency | 1000 | 94.0 | 0.0 | 94.0 | 3.25 | 0.20 | 3.05 |
| retry_storm_same_idempotency_key | 1000 | 0.0 | 0.0 | 99.9 | 3.25 | 0.00 | 3.25 |

End to end latency, 1,000 sequential requests (gateway + mock upstream, ms): direct p50 1.17 / p95 2.04; protected p50 2.29 / p95 3.47; added p50 1.12 / p95 1.43.
Throughput, 3,000 requests at concurrency 32: direct 924 req/s, protected 646 req/s.

## Aggregates (medians, abusive scenarios only, 6,200 abusive requests per run)

| Code | Abusive requests blocked (DENY) | Abusive upstream calls prevented (DENY + idempotent dedupe) | Same, excluding the fully rotating farm | $ saved per 1,000 abusive calls (this scenario mix) |
|---|---:|---:|---:|---:|
| Original | 37.5% | 37.5% | 55.3% | $1.22 |
| With enterprise patch | 49.7% | 65.8% | 97.1% | $10.16 |

False positives on the normal baseline (200 distinct users x 5 calls, 2,000 char prompts): 0.0% blocked, 0.0% limited, both before and after.
The $ per 1,000 figure depends heavily on the scenario mix (the token flood dominates); per scenario numbers above are the honest unit.

## Not measured
* Legit users who share a device fingerprint or email domain normalisation (would be clustered together; FP rate unknown).
* Postgres / Redis mode, multi pod, Kubernetes. All numbers are single process memory mode.
* Real provider latency/pricing. Upstream is a local mock with ~0 ms service time, so "added latency" is the absolute overhead of one extra local HTTP hop to /decide.
* Docker image build (Docker not run on the box).
