# Runbook: Redis degraded

### 🧩 What
BleedStop can keep answering `/decide` if Redis dies, using a **local** ledger (per process).

### 🎯 When
- `bleedstop_degraded_redis_total` increases  
- Health shows Redis unhealthy / sync errors  
- Multi-pod deploy + spend looks “too high”

### Steps

1. **Confirm**
   ```bash
   curl -s http://localhost:3000/metrics | findstr degraded_redis
   curl -s http://localhost:3000/api/health
   ```
2. **Check Redis**
   ```bash
   redis-cli -u $env:REDIS_URL PING
   # Docker: docker compose ps redis
   # K8s: kubectl -n bleedstop-dev get pods -l app.kubernetes.io/name=redis
   ```
3. **Stabilize money path**
   - If many API replicas: **scale to 1** until Redis is healthy (stops split-brain spend).  
   - Or fail closed at the edge (stop sending traffic) if spend risk > downtime risk.
4. **Fix Redis** (disk full, bad URL, network policy, OOM).  
5. **Recover**
   - Restart API pods so they re-attach to Redis.  
   - Spot-check one cluster’s spend on dashboard / `/ledger`.  
6. **Audit** — note time window in a postmortem if real money moved.

### Rollback / undo
N/A — restoring Redis + restart returns shared ceilings.

### Related
- ADR-0009, postmortem `2026-10-20-redis-degraded-ceilings.md`
