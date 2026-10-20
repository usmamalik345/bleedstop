# Load test (local mock upstream)

BleedStop and a local mock upstream ran on the same machine, one after the other, so the difference is BleedStop's own work. This is not a call to a model provider. A provider's own time would dominate a real end-to-end call.

## Machine

- Date: 2026-10-20T19:17:15.545Z
- OS: win32 10.0.22621 (x64)
- CPU: 11th Gen Intel(R) Core(TM) i7-1185G7 @ 3.00GHz x 8
- Memory: 34073251840 bytes
- Node: v24.13.0
- Unpaid ceiling read from /api/health: $5

## How to run

```bash
npm install
npm run loadtest
```

Each scenario samples for 6s at concurrency 24 (this is the row's N, percentiles, decisions, sample req/s, and max spend). Then autocannon v8 runs the first body of that scenario again for 6s with 24 connections. autocannon's body is fixed, so that column is one account repeated. State is cleared with POST /ledger/reset before each BleedStop sample. Redis and Postgres are off.

Percentile method for the sample columns: sort the latencies, index = ceil(p * N) - 1. autocannon does not publish p95; its columns below are the ones it does publish (p50, p90, p97.5, p99).

## Results

| Scenario | N (sample) | sample req/s | autocannon req/s | errors | p50 ms BleedStop | p95 ms | p99 ms | p50 ms mock | added p50 | added p95 | added p99 | decisions | correct / N | max cluster spend USD |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|
| normal_users | 25455 | 4232.631 | 5228.67 | 0 | 5.138 | 9.451 | 14.511 | 2.416 | 2.722 | 4.131 | 6.719 | ALLOW 25455 | 25455 / 25455 | 0.015 |
| leaked_key_flood | 17900 | 2975.388 | 2178 | 0 | 7.773 | 12.033 | 15.909 | 2.294 | 5.479 | 6.958 | 9.6 | ALLOW 14, LIMIT 46, DENY 17840 | 17900 / 17900 | 4.338 |
| retry_storm | 28993 | 4810.446 | 4483.17 | 0 | 4.802 | 7.556 | 9.267 | 2.18 | 2.622 | 2.97 | 3.7 | ALLOW 60, DENY 28933 | 28993 / 28993 | 0.9 |
| token_flood | 26879 | 4465.713 | 5808.67 | 0 | 4.861 | 8.724 | 12.03 | 2.592 | 2.269 | 3.414 | 5.183 | DENY 26879 | 26879 / 26879 | 0 |

## What "correct" means

- normal_users: ALLOW (fresh unpaid user, 200 tokens)
- leaked_key_flood: ALLOW, LIMIT or DENY, and spendAfter never above that response's ceiling
- retry_storm: ALLOW, LIMIT or DENY, and spendAfter never above that response's ceiling
- token_flood: DENY (400000 tokens over the unpaid per-request cap)

Added latency is BleedStop sample percentile minus the mock sample percentile. A negative number means the mock run was slower on that percentile (timer noise or a cold socket). The two runs are sequential, not parallel.

Raw JSON: `results/loadtest.json`.
