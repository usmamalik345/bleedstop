# Scale and correctness (local processes, real Redis 7)

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