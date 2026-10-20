# Protected SaaS — FastAPI + BleedStop

### 🧩 What
Python FastAPI app that asks BleedStop before OTP / AI / payment spend.

### 🎯 Why
Show **Python + FastAPI** experience while the control plane stays language-agnostic (HTTP).

### ⚙️ How it works
```text
FastAPI route  →  BleedStop POST /decide  →  ALLOW / LIMIT / DENY
                      ↓
              only then do paid work
```

## Setup

```bash
# from repo root
npm start

# new terminal
cd apps/protected-saas-python
pip install -r requirements.txt
uvicorn main:app --reload --port 5000
```

Or from root (after pip install once):

```bash
npm run app:py
```

## Test

```powershell
# health
Invoke-RestMethod http://localhost:5000/health

# payment (same $5 ceiling as Node)
Invoke-RestMethod -Method POST -Uri http://localhost:5000/payments/attempt `
  -ContentType "application/json" `
  -Body '{"actorId":"py-user","email":"a@b.com","deviceFingerprint":"fp-py","paid":false}'
```

Docs UI: http://localhost:5000/docs

## Pytest

```bash
pip install -r requirements.txt
npm run test:py
# or: cd apps/protected-saas-python && pytest -q
```

Covers: health, payment ALLOW/DENY, client `guarded`, client `reconcile`.

## Python reconciler worker

### 🧩 What
Background loop that POSTs BleedStop `/reconcile` every 30s.

### 🎯 Why
Ghost spend kill switch + Slack — without sitting on the `/decide` hot path.

```bash
npm start
npm run worker:reconciler:py
```

Then dashboard **Run leaked-key red team** (or wait for next tick) → Slack alert.

## Interview line

> “BleedStop is an HTTP control plane. I integrated it with both Express and FastAPI — same ALLOW/DENY rules, two languages. I also added pytest and a Python reconciler worker.”
