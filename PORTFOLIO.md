# Portfolio guide — BleedStop

## One-line pitch

I built an abuse cost control plane that decides ALLOW/LIMIT/DENY before SMS/LLM spend, groups multi-account bots into one dollar ceiling, and kills leaked keys when vendor usage drifts from the app ledger.

## What to show in 3 minutes

1. Architecture sketch (hot path rules vs off-path agents)
2. `apps/protected-saas` middleware integration
3. `npm run benchmark` output table ($ without vs with)
4. Dashboard incident + investigator citations
5. Optional: Helm chart under `deploy/helm/bleedstop`

## Commands for the video / live demo

```bash
npm start
npm run app
npm run benchmark
```

Open:
- http://localhost:3000/dashboard/
- http://localhost:4000/health

## Talking points (interview)

- Why AI is **not** on the deny path (latency, determinism, prompt injection)
- Reserve/commit idea for concurrent spend races
- Cluster identity (device/email signals) beats per-account rate limits
- Ghost spend: inline SDK cannot see direct key abuse; reconcile closes the gap
- RAG only for investigator/rule proposals, with citation checks

## What is “real” vs “staging”

| Real for portfolio | Still staging-safe |
|--------------------|--------------------|
| Express middleware you can paste into production apps | Attack traffic only against your own sample app |
| Deterministic policy engine + kill switch | Mock vendor usage unless `OPENAI_API_KEY` set |
| Benchmark with measurable $ saved | No need to burn hundreds in Twilio to prove the design |
| K8s manifests / Postgres persistence | kind/compose, not necessarily paid EKS yet |

## README snippet you can paste after benchmark

```md
### Benchmark (own staging app)
- OTP farm blocked after unpaid cluster ceiling
- Free AI abuse limited/denied under shared cluster bill
- Leaked-key ghost spend detected; key disabled
```

Paste the exact table printed by `npm run benchmark`.
