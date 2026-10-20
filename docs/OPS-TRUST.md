# Ops + trust pack

Real projects need more than “does deny work?” — they need **shared state**, **numbers you can scrape**, **who changed what**, and **no double charges**.

## 1. Redis shared cluster spend

**What:** Cluster bill lives in Redis too (when `REDIS_URL` is set).

**Why:** Two API pods must see the same $ tab. Memory alone = each pod has its own wrong total.

**How:** Before `/decide`, we `syncSpendFromRedis`. After a charge, we `incr` Redis. Amounts stored as scaled integers (avoids float bugs).

**Try:** Start Redis, set `REDIS_URL`, hit `/decide` twice from different processes — ceiling still holds.

## 2. Prometheus `/metrics`

**What:** Plain-text counters at `GET /metrics`.

**Why:** Grafana/Prometheus scrape this in every serious deploy.

**See also:** `/api/health` → `metrics` JSON for humans.

## 3. Rule audit log

**What:** `GET /audits` — who flipped shadow ↔ enforce.

**Why:** “Who turned off the SMS rule at 2am?” must be answerable.

**How:** `setRuleMode` writes `recordAudit` + bumps a metric. Dashboard shows the panel.

## 4. Stronger decide idempotency

**What:** Send `idempotencyKey` on `/decide` (auto mode).

**Why:** Network retry must not charge twice.

**How:** First ALLOW is cached; second request returns `replay: true` with the same `spendAfter`.

```bash
curl -s -X POST http://localhost:3000/decide -H "Content-Type: application/json" -d "{\"actorId\":\"u1\",\"action\":\"payment.attempt\",\"paid\":false,\"idempotencyKey\":\"pay-1\",\"signals\":{\"deviceFingerprint\":\"fp1\"}}"
# run again with same idempotencyKey → replay:true
```

## Quick checks

| Check | Command / place |
|--------|------------------|
| Metrics | `curl http://localhost:3000/metrics` |
| Audits | Toggle a rule on dashboard → `GET /audits` |
| Idempotency | Same `idempotencyKey` twice |
| Redis | Health `infra.redis: true` when Redis is up |
