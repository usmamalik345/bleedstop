# Operator runbooks

Step-by-step “what do I click / curl when X breaks?”

Code that performs kill-switches: `src/runbooks.js`  
Audits: `GET /audits`

| Runbook | When to use |
|---------|-------------|
| [redis-degraded.md](./redis-degraded.md) | Redis errors / degraded_redis metric up |
| [ghost-spend-key-leak.md](./ghost-spend-key-leak.md) | Vendor bill ≫ app ledger |
| [otp-farm-freeze.md](./otp-farm-freeze.md) | SMS/OTP farm on one cluster |
| [rule-mode-rollback.md](./rule-mode-rollback.md) | Bad rule flip shadow ↔ enforce |
