# BleedStop measured results (v0.5.0, local box)

All numbers measured on one 8 vCPU box with a deterministic mock LLM upstream, no real provider calls. Price assumption for $: $2.50 per 1M input tokens, $10 per 1M output tokens. Raw JSON next to this file.

## 1. Attack suite (`benchmark/attack-suite`, end to end through an app using the SDK, 3 runs, medians)

| Scenario | Requests | Original blocked | v0.4 patch blocked | v0.5 blocked | v0.5 upstream calls prevented | v0.5 $ saved per 1,000 calls |
|---|---:|---:|---:|---:|---:|---:|
| Normal users (FP) | 1000 | 0.0% | 0.0% | 0.0% | 0.0% | $0.00 |
| Farm, 100 accounts, one device | 2000 | 83.1% | 97.0% | 97.0% | 97.0% | $3.15 |
| Farm, 100 accounts, all signals rotated, one /24 | 2000 | 0.0% | 0.0% | 66.7% | 66.7% | $2.17 |
| Token flood, 400k chars | 200 | 0.0% | 100.0% | 100.0% | 100.0% | $252.00 |
| Retry storm, no key | 1000 | 66.2% | 94.0% | 94.0% | 94.0% | $3.05 |
| Retry storm, same idempotency key | 1000 | 0.0% | 0.0% | 0.0% | 99.9% | $3.25 |

Added latency (app → BleedStop → mock, 1,000 sequential): p50 1.16 ms, p95 1.43 ms. Throughput at concurrency 32: 678 req/s protected vs 916 direct.

## 2. Golden set evals (`evals/`, 12,140 labeled requests)

See EVAL-REPORT.md for all scenarios. Summary:

| Config | Overall precision | Overall recall | F1 | Benign FP rate | Rotated same /24 recall | Residential proxy one ASN recall | ISP users FP | Campus NAT FP |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| A original code | 85.9% | 61.4% | 71.6% | 31.4% | 83.1% | 83.1% | 43.7% | 66.2% |
| B current, ASN union on | 80.2% | 75.7% | 77.9% | 58.5% | 97.0% | 97.0% | 90.0% | 94.0% |
| C current default | 100.0% | 48.0% | 64.8% | 0.0% | 66.7% | 0.0% | 0.0% | 0.0% |
| D current, ASN spread enforce | 93.8% | 65.4% | 77.0% | 13.6% | 66.7% | 80.0% | 66.7% | 0.0% |

## 3. Agent guard (`evals/run-agent-evals.js`)

| Set | Detection (block) | FP (block) |
|---|---:|---:|
| Dev set 55/57 (tuned on) | 96.4% | 0.0% |
| Held-out 40/40 (never tuned on) | 22.5% | 0.0% |
| Tool sequences 7/5 | 100% | 0% |

Lexical classifier: no measurable lift.

## 4. Scale, Redis correctness, rate limit, degradation

Box: 8 vCPU, Node v20.19.2; load generator, LB and instances share the box. Load: 20,000 /decide calls, unique actors, concurrency 64, after 2,000 warmup calls; medians of 3 runs. Latency is client side through the LB. Correctness: 2,000 concurrent calls (concurrency 100) from one cluster against a $5 ceiling at $0.015 per call (flat price, velocity rule disabled), plus 200 unrelated actors that must get 200 distinct cluster ids. Worst case of 3 runs shown for correctness.

| Topology | Throughput req/s | p50 ms | p95 ms | p99 ms | Errors | Allowed (one cluster) | Max charged vs $5 | Max overspend | Unrelated actors, distinct ids (min) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1x memory | 3786 | 15.95 | 25.48 | 34.36 | 0 | 338 | $4.986 | $0.000 | 200/200 |
| 1x memory + OTel OTLP export | 2519 | 23.91 | 37.62 | 52.03 | 0 | 338 | $4.986 | $0.000 | 200/200 |
| 1x redis (atomic) | 3283 | 18.64 | 25.37 | 33.15 | 0 | 339 | $4.995 | $0.000 | 200/200 |
| 2x redis (atomic) + LB | 4957 | 11.89 | 27.11 | 36.30 | 0 | 333 | $4.995 | $0.000 | 200/200 |
| 3x redis (atomic) + LB | 6291 | 9.01 | 21.12 | 31.89 | 0 | 333 | $4.998 | $0.000 | 200/200 |
| 2x redis LEGACY (REDIS_ATOMIC=0) + LB | not measured | | | | | 342 | $5.130 | $0.130 | 100/200 |

/decide rate limit (100 req/s, burst 200, one caller): 1000 requests in 0.48s → 247 accepted (theoretical max 249), 753 answered 429.
Redis outage: redis-server SIGKILLed after request 1000 of 4000 → 4000 HTTP 200, 0 errors; process switched to local mode (bleedstop_degraded_redis_total = 32, one per in flight request at kill time).

## 5. Tests

* Node: 42 tests, 39 pass; the 3 failures need `data/kb/*.json`, which was not in the zip (RAG knowledge base).
* Python: 16 unit tests pass, `mypy --strict` clean; 2 end to end tests pass against a live server.
* Original portfolio benchmark: PASS. Drill: 3/3.

## Not measured
* Docker images and Kubernetes (Docker not available on the box); Postgres mode.
* Real provider latency or pricing.
* Field accuracy: golden sets and rules share an author.