# Sprint — paid/unpaid ceilings + rule toggle + FastAPI Depends

## A1 — Paid vs unpaid ceilings

| User type | Env | Default |
|-----------|-----|---------|
| Unpaid / free | `UNPAID_CEILING_USD` | $5 |
| Paid | `PAID_CEILING_USD` | $50 |

Request body: `"paid": true` → paid ceiling.

Rules: `R-ceiling` (unpaid), `R-paid-ceiling` (paid).

## A4 — Dashboard shadow ↔ enforce

Open http://localhost:3000/dashboard/ → **Rules** panel.

Buttons toggle each rule between:
- **shadow** = log only (no block)
- **enforce** = real ALLOW/LIMIT/DENY

API: `POST /rules/:id/mode` `{ "mode": "shadow" | "enforce" }`

## B6 — FastAPI `Depends` guard

```python
from deps import require_bleedstop

@app.post("/payments/attempt")
async def pay(
    body: PayBody,
    decision: dict = require_bleedstop("payment.attempt", "stripe-live-key"),
):
    ...
```

Like Express `protectPaidAction` — guard runs before handler.

## Test

```bash
npm test
npm run test:py
npm start   # refresh dashboard — see Paid ceiling card + rule toggles
```
