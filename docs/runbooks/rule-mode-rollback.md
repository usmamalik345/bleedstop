# Runbook: Roll back a rule mode change

### 🧩 What
Rules can be `shadow` (log only) or `enforce` (actually LIMIT/DENY).  
Wrong flip at 2am can block real users — or fail to block bots.

### 🎯 When
- False positives spike after a mode change  
- Attack succeeds because a rule is still shadow  
- Someone asks “who changed this?”

### Steps

1. **Who / what**
   ```bash
   curl -s http://localhost:3000/audits
   ```
2. Note `before` → `after` and actor.  
3. **Rollback** — set the rule back to previous mode on the dashboard (or rule API).  
4. Confirm audit wrote the reverse change.  
5. If enforce was too hot: leave **shadow**, run backtest (`src/rules/backtester.js` path), then re-enforce.

### Undo
Flip mode again; every change should be audited.

### Related
- `docs/OPS-TRUST.md` (audit log), shadow mode in LEARN.md
