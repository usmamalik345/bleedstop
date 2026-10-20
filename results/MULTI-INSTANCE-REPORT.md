# Multi-instance budget race

one URL in front of the bleedstop Service (deploy/k8s/bleedstop.yaml sets 3 replicas). Ceiling $1 from the server's /api/health.

## Machine

- Date: 2026-10-20T19:54:22.016Z
- OS: linux 7.0.0-1017-azure (x64)
- CPU: AMD EPYC 7763 64-Core Processor x 4
- Memory: 16760344576 bytes
- Node: v20.20.2
- Mode: url http://127.0.0.1:3000

## Command

```bash
node deploy/k8s/race.js --url http://127.0.0.1:3000 --n 80
```

## Result

| N | errors | decisions | charged USD (ALLOW+LIMIT estimatedCost) | max spendAfter | ceiling | over ceiling |
|---:|---:|---|---:|---:|---:|---|
| 80 | 0 | ALLOW 2, LIMIT 58, DENY 20 | 0.574 | 0.574 | 1 | no |

Charged USD is the sum of `estimatedCost` on ALLOW and LIMIT responses. The Postgres UPDATE allows a charge only when `spend + cost <= ceiling`. A yes in the last column means two processes both spent money the ceiling should have stopped.
