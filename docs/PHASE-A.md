# Phase A — Multi-tenant keys, Slack, charts, CI

## 1) Multi-tenant API keys

### 🧩 What
Apps send `X-API-Key`. BleedStop maps that key → `tenantId` (customer).

### Setup
```env
BLEEDSTOP_API_KEYS=demo-key:local-dev,acme-key:tenant-acme
```

Client:
```js
createClient({
  baseUrl: "http://localhost:3000",
  apiKey: process.env.BLEEDSTOP_API_KEY, // e.g. demo-key
});
```

Or header: `X-API-Key: demo-key`

### Behavior
- **Empty env** → auth off (learning mode)
- **Keys set** → POST routes need a valid key; GET (dashboard) stays open
- Postgres writes use the resolved tenant via AsyncLocalStorage

### Dashboard
Paste the API key in the header field (saved in localStorage) before red team / reset.

---

## 2) Slack alert on ghost spend

```env
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/XXX/YYY/ZZZ
```

When reconcile kills a leaked key, BleedStop posts a Slack message with key, gap $, and incident id.

Create webhook: Slack → Apps → Incoming Webhooks.

---

## 3) Dashboard charts

Open http://localhost:3000/dashboard/

- **Cluster spend** bars (top clusters)
- **ALLOW / LIMIT / DENY** counts from recent events

Data from `GET /api/stats`.

---

## 4) GitHub Actions CI

File: `.github/workflows/ci.yml`

On push/PR: Node 18 + 20 → `npm ci` → `npm run lint` → `npm test`

---

## Quick verify

```bash
npm test
npm run lint
# optional: set BLEEDSTOP_API_KEYS + SLACK_WEBHOOK_URL, restart npm start
```
