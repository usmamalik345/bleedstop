# Postmortem: Ghost spend after leaked API key

**Date:** 2026-10-22 (demo / staging drill)  
**Status:** closed  
**Severity:** high (real $ if a vendor key leaks)  
**Authors:** BleedStop learning notes  

## Summary

An attacker used a **vendor API key directly** (Twilio/OpenAI-style), bypassing the app’s `/decide` SDK path.  
App ledger looked calm; **vendor usage** was higher → **ghost spend**.  
Reconciler flagged the drift; runbook **disabled the key**.

## Impact

- Inline SDK / `/decide` alone **cannot** see this traffic.  
- Dollars at risk = vendor bill − app recorded spend (drill used mock vendor).  
- Blast radius: one key → all features that key can call.

## Detection

- Reconciler / `npm run demo:ghost` / dashboard “Simulate leak”.  
- Metric: `bleedstop_reconcile_ghosts_total`.  
- Investigator agent pulled playbook chunks with citations (off hot path).

## Root cause

Door bouncer (`/decide`) only sees traffic that asks permission.  
A leaked key is a **side door** into the vendor.  
Need a second loop: compare vendor usage vs app ledger on a schedule (CronJob / worker).

## What we did

1. Ran ghost drill; confirmed kill-switch via `runbook.disable_key`.  
2. Wrote operator runbook: `docs/runbooks/ghost-spend-key-leak.md`.  
3. Kept Helm CronJob calling API `/reconcile` (single ledger, not a second brain).

## Action items

| Item | Done? |
|------|-------|
| Document OTP freeze vs key disable | yes (runbooks) |
| Prefer scoped vendor keys in prod checklist | `docs/PRODUCTION-READINESS.md` |
| Real Twilio usage connector | later (LEARN.md) |

## Lessons

- Ceiling on the app ≠ ceiling on the vendor.  
- Reconcile + kill-switch is the ghost-spend product; agents only explain.
