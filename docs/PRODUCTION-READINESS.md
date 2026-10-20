# Production readiness

This is the checklist before letting real users touch real money.

## Login and roles

Set dashboard users:

```env
DASHBOARD_USERS=admin:use-a-long-password:admin,ops:another-password:operator
DASHBOARD_SESSION_SECRET=64-random-hex-characters
```

Roles:

- `viewer`: read only
- `operator`: can toggle rules, run reconcile, run drills, use runbooks
- `admin`: can clear staging data and re-ingest RAG

If `DASHBOARD_USERS` is empty, BleedStop stays in local learning mode and dashboard writes are open.

## Secret safety

Run:

```bash
npm run secrets:check
```

Before sharing or deploying:

- rotate any real Slack webhook or vendor key that was pasted into chat
- keep `.env` out of git
- use restricted vendor keys where possible
- prefer read-only usage keys for billing sync

## Persistent audits

Audits now write to the `audit_events` table when Postgres is on. `Clear staging data` no longer deletes audit rows.

## Backups

Run:

```bash
npm run backup:pg
```

This writes a SQL file into `backups/` (ignored by git).

## Load proof

With the server running:

```bash
npm run load:decide
```

The script prints p50/p95/p99 latency. The PDF target is roughly p95 under 20ms on your chosen environment.

## Simple production deploy

1. Copy `.env.example` to `.env.production`.
2. Set:
   - `DOMAIN`
   - `POSTGRES_PASSWORD`
   - `DASHBOARD_USERS`
   - `DASHBOARD_SESSION_SECRET`
   - real Slack/vendor/API keys only if needed
3. Run:

```bash
docker compose --env-file .env.production -f deploy/production/docker-compose.prod.yml up -d --build
```

Caddy gives HTTPS automatically when DNS points to the server.

## Still not included

- managed cloud backups
- KMS encryption for customer vendor keys
- SSO / OAuth
- live OpenAI/Twilio usage connectors
- Grafana dashboards
- EKS / Argo CD
