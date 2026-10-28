# Runbook: Ghost spend / leaked vendor key

### 🧩 What
Vendor usage is higher than the app ledger → money leaving through a **side door** (leaked key).

### 🎯 When
- Reconcile reports ghost spend  
- Dashboard / investigator shows `ghost_spend`  
- Vendor console shows traffic you did not send through the app

### Steps

1. **Confirm drift**
   ```bash
   # local demo
   npm run demo:ghost
   curl -s -X POST http://localhost:3000/reconcile -H "Content-Type: application/json" -d "{}"
   ```
2. **Identify key** — note `keyId` from reconcile / dashboard.  
3. **Kill switch (disable key)** — dashboard runbook **or** API that wraps `disableVendorKey` in `src/runbooks.js`.  
4. **Verify** vendor traffic stops; ghost growth flattens.  
5. **Rotate** the real vendor key in the vendor console; update secrets; never commit them.  
6. **Audit** — `GET /audits` should show `runbook.disable_key`.

### Undo
`enableVendorKey` / runbook enable — only after you trust the key is rotated.

### Related
- `src/reconciler.js`, Helm CronJob, postmortem `2026-10-22-ghost-spend-leaked-key.md`
