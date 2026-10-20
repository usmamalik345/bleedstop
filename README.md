# BleedStop

**Abuse cost control plane** for Node apps: stop bot farms and leaked API keys from burning SMS/LLM budgets.

This repo is built as a **portfolio / staging control plane**, not a click-toy.  
Paid actions ask BleedStop before money leaves. Decisions are **deterministic rules**. Agents only explain.

## What problem it solves

Small SaaS apps get hit by:
- OTP / SMS pumping
- Free-tier AI abuse across many fake accounts
- Leaked browser/API keys that spend **outside** your app

Vendor tools protect one slice (Twilio-only, OpenAI-only, Stripe-only). BleedStop tracks **$ per abuse cluster across actions** and reconciles **ghost spend**.

## Architecture

```text
Your SaaS  --SDK/middleware-->  BleedStop /decide  --> ALLOW | LIMIT | DENY
                                      |
                                 cluster ledger
                                      |
                    reconcile (app ledger vs vendor usage)
                                      |
                         investigator + rule proposals (off hot path)
```

## Quick start (portfolio benchmark)

```bash
npm install
npm start          # control plane :3000
```

New terminal:

```bash
npm run app        # protected SaaS sample :4000
```

New terminal:

```bash
npm run benchmark  # red-team numbers for your README
```

Dashboard: http://localhost:3000/dashboard/  
Checkout (Stripe test): http://localhost:4000/checkout.html

## Benchmark results (portfolio proof)

Run yourself: `npm run benchmark` (needs `npm start` + `npm run app`).

| Scenario | Without | With BleedStop | Saved |
|----------|--------:|---------------:|------:|
| OTP / SMS pumping | $6.00 | $1.60 | **$4.40** |
| Free AI credit abuse | $9.00 | $3.39 | **$5.61** |
| Card testing / payment attempts | $4.00 | $0.00 | **$4.00** |
| Leaked key ghost spend | $55.00 | — | **$55.00** (key disabled) |
| **Total** | **$74.00** | | **~$69 saved** |

## Drop into YOUR real Express app

```js
import { createClient, protectPaidAction } from "./src/sdk/express.js";

const bleedstop = createClient({ baseUrl: process.env.BLEEDSTOP_URL });

app.post(
  "/otp",
  protectPaidAction(bleedstop, { action: "sms.send" }),
  sendOtpHandler
);
```

See:
- [`apps/protected-saas/server.js`](./apps/protected-saas/server.js) — full sample (OTP, AI, Stripe checkout)
- [`apps/my-saas-starter/server.js`](./apps/my-saas-starter/server.js) — minimal copy-paste starter
- [`docs/INTEGRATE-YOUR-APP.md`](./docs/INTEGRATE-YOUR-APP.md) — step-by-step for your own Express app

```bash
npm run my-app   # starter on :4100
```

## Stripe (test mode)

1. Add `STRIPE_SECRET_KEY` + `STRIPE_PUBLISHABLE_KEY` to `.env`
2. Open http://localhost:4000/checkout.html — test card `4242 4242 4242 4242`
3. Webhooks sync confirmed payments to app ledger:

```bash
stripe listen --forward-to localhost:3000/webhooks/stripe
# put whsec_... in .env as STRIPE_WEBHOOK_SECRET, restart npm start
```

See [`docs/STRIPE-WEBHOOKS.md`](./docs/STRIPE-WEBHOOKS.md).

## FastAPI (Python) sample

Same BleedStop guard, Python stack for portfolio:

```bash
pip install -r apps/protected-saas-python/requirements.txt
npm start          # control plane :3000
npm run app:py     # FastAPI :5000
```

- App: http://localhost:5000  
- Swagger: http://localhost:5000/docs  
- Guide: [`apps/protected-saas-python/README.md`](./apps/protected-saas-python/README.md)
- Sprint notes: [`docs/SPRINT-CEILINGS-RULES.md`](./docs/SPRINT-CEILINGS-RULES.md)

```bash
npm run test:py              # pytest (mocked BleedStop)
npm run worker:reconciler:py # Python reconcile loop → Slack on ghost
```

Ceilings: unpaid `$UNPAID_CEILING_USD` (default 5) vs paid `$PAID_CEILING_USD` (default 50).  
Dashboard → Rules: toggle **shadow ↔ enforce**.

## Phase A (advanced portfolio)

- Multi-tenant `X-API-Key` → tenant routing ([docs/PHASE-A.md](./docs/PHASE-A.md))
- Slack alert on ghost-spend kill switch (`SLACK_WEBHOOK_URL`)
- Dashboard charts: cluster spend + ALLOW/LIMIT/DENY
- GitHub Actions CI (Node 18/20 → lint + test)

## Live OpenAI mode (optional, real money)

1. Put a **restricted** key in `.env`:
   ```env
   OPENAI_API_KEY=sk-...
   OPENAI_MODEL=gpt-4o-mini
   ```
2. Restart `npm run app`
3. `/ai/rewrite` calls **real OpenAI**, still behind BleedStop middleware
4. Keep a hard provider budget alert/limit on the key

Without the key, app runs **offline stub mode** (same protection path, no external spend).

## Real Postgres

```bash
npm run db:up
# .env already has DATABASE_URL
npm start
```

Health should show `"storage":"postgres"`.

## Kubernetes

See `deploy/README.md` (kind + Helm: API, HPA, NetworkPolicy, CronJob reconcile).

## Portfolio docs

- [PORTFOLIO.md](./PORTFOLIO.md) — how to present this in interviews
- [docs/HOW-IT-WORKS-URDU.md](./docs/HOW-IT-WORKS-URDU.md) — short Roman Urdu explanation
- [docs/REAL-DATABASE.md](./docs/REAL-DATABASE.md) — persistence

## Scripts

| Script | Purpose |
|--------|---------|
| `npm start` | Control plane + dashboard |
| `npm run app` | Protected SaaS sample + checkout UI (Express :4000) |
| `npm run app:py` | Protected SaaS sample (FastAPI :5000) |
| `npm run test:py` | Pytest for FastAPI client + routes |
| `npm run worker:reconciler:py` | Python ghost-spend reconciler loop |
| `npm run my-app` | Minimal “your app” integration starter |
| `npm run benchmark` | Attack benchmark + $ saved table |
| `npm test` | Unit tests |
| `npm run db:up` | Postgres + Redis |
| `npm run stack:up` | Full docker compose |

## Honest scope

- Control plane, SDK, clustering, rules, ghost reconcile, RAG investigator, K8s chart: **implemented**
- Mock vendor bills used when no live keys (still valid for abuse-control engineering)
- Live OpenAI path: **optional via env**
- Live Twilio: wire the same middleware around your Twilio call (pattern already in `/auth/otp`)
