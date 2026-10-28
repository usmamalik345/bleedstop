# Runbook: Freeze OTP / SMS for a bot cluster

### 🧩 What
Pre-approved kill-switch: mark a **cluster** so OTP/SMS is blocked (`src/runbooks.js` → `freezeOtp`).

### 🎯 When
- OTP farm / SMS drain on one device/email cluster  
- Ceiling alone is not enough mid-incident  
- Operator wants a reversible hard stop

### Steps

1. Find `clusterId` on dashboard / `/ledger` (example `C-1`).  
2. Freeze via dashboard runbook control **or** the runbook API your server exposes.  
3. Confirm new OTP decides are denied / blocked for that cluster.  
4. Check audit: `runbook.otp_freeze`.  
5. After incident: `unfreezeOtp` when safe.

### Undo
`otp_unfreeze` — reversible by design.

### Tip
Prefer **enforce rules + ceilings** for steady state; freeze is for “stop the bleeding now.”
