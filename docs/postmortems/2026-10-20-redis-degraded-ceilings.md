# Postmortem: Redis down → per-process ceilings

**Date:** 2026-10-20 (lab / staging)  
**Status:** closed  
**Severity:** medium (money risk if multi-instance + Redis dies)  
**Authors:** BleedStop learning notes  

## Summary

When Redis became unreachable mid-load, BleedStop **did not crash**.  
Each API process switched to **local ledger mode** (`bleedstop_degraded_redis_total`).  
Ceilings still worked **per process**, but **not across pods** — so two pods could overspend the shared cluster bill.

## Impact

- User-facing `/decide`: **0 hard errors** in a 4,000-request kill-Redis drill (see ADR-0009).  
- Correctness: shared cluster ceiling temporarily **unreliable** until Redis returned + restart/sync.  
- Duration in drill: Redis stopped for the test window only.

## Detection

- Metric: `bleedstop_degraded_redis_total` climbed.  
- Health / logs: Redis sync errors, then local-mode behavior.  
- Alert idea: page if `degraded_redis` increases and replica count > 1.

## Root cause

Shared spend lives in Redis so many pods share one “tab.”  
On Redis errors we **fail soft** (keep answering) instead of fail hard (5xx everyone).  
Trade-off: availability up, **cross-instance money correctness** down while degraded.

## What we did

1. Confirmed fail policy + degradation in `src/` + ADR-0009.  
2. Documented operator steps in `docs/runbooks/redis-degraded.md`.  
3. Kept Prometheus counter so Grafana can alert later.

## Action items

| Item | Owner style | Done? |
|------|-------------|-------|
| Runbook for Redis degraded | docs | yes |
| Alert rule draft on degraded_redis | `deploy/observability/alert-rules.yml` | check / extend |
| Long-term: sticky “degraded” banner on dashboard | product | open |

## Lessons

- Soft-fail is right for login paths; money paths need **visibility** when soft-failing.  
- Multi-instance demos must kill Redis on purpose once — or you ship a surprise.

## Template (copy for next incident)

```md
# Postmortem: <title>
**Date:**
**Severity:**
## Summary
## Impact
## Detection
## Root cause
## What we did
## Action items
## Lessons
```
