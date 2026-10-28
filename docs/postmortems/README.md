# Postmortems

Short write-ups of **real failure modes** we hit while building BleedStop  
(local / staging lab — not a fake employer on-call story).

| Date | Title | Impact |
|------|-------|--------|
| 2026-10-20 | [Redis down → per-process ceilings](./2026-10-20-redis-degraded-ceilings.md) | Cross-pod overspend risk while degraded |
| 2026-10-22 | [Ghost spend after leaked key](./2026-10-22-ghost-spend-leaked-key.md) | Vendor bill drifted past app ledger |

**How to write a new one:** copy the template at the bottom of either file.  
Honest > impressive. Interviewers prefer “we measured X” over “we saved the company.”
