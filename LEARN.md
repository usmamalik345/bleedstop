# Learn BleedStop (guided path)

This project is built so you can **learn by touring working code**.  
Don’t memorize everything. Walk folder by folder.

## Big idea (30 seconds)

Your app spends money (SMS, AI, email).  
**Before** it spends, it asks BleedStop.  
BleedStop keeps a **live bill per bot group**, and later checks the **vendor bill** for leaked keys.

## Tour order

### Day 1 — Door bouncer
1. Read `src/priceCatalog.js` — price menu  
2. Read `src/ledger.js` — bill + reserve/commit  
3. Read `src/decision.js` — ALLOW / LIMIT / DENY  
4. Run `npm start` → open `http://localhost:3000/dashboard/`  
5. Run `npm run demo`

**Can you explain?** Why rules decide, not AI?

### Day 2 — Bot groups
1. Read `src/cluster.js` — Union-Find sticky notes  
2. Run `npm run demo` and watch many accounts share `C-1`  
3. Check `/ledger` → `clusters`

**Can you explain?** Why a new account must not get a new $5?

### Day 3 — Ghost spend
1. Read `src/keyLedger.js` + `src/vendorMock.js`  
2. Read `src/reconciler.js`  
3. Run `npm run demo:ghost`  
4. Click **Simulate leak** on the dashboard

**Can you explain?** Why `/decide` alone can’t stop a leaked key?

### Day 4 — Rules + investigator
1. Read `src/rules/engine.js` + `store.js` + `backtester.js`  
2. Read `src/investigator.js`  
3. Run `npm run demo:full`  
4. Open `/investigate` and `/report/morning`

**Can you explain?** What is shadow mode?

### Day 5 — Real app wiring
1. Read `src/sdk/client.js`  
2. Run `npm start` and `npm run victim`  
3. Call victim endpoints with curl/Postman  
4. Run `npm run drill` and `npm test`

### Day 6 — RAG + agents
1. Read `data/kb/*.json` then `src/rag/*`  
2. `curl "http://localhost:3000/rag/search?q=ghost%20spend"`  
3. Read `src/agents/*` — notice they never call `/decide` decisions  
4. Run `npm run demo:ghost` then open `/investigate` — look for `retrieved` + `citations`

**Can you explain?** Why retrieved docs are wrapped as DATA, not instructions?

### Day 7 — Docker + Kubernetes
1. Read `deploy/README.md`  
2. `docker compose up --build` — API + Postgres + Redis + reconciler  
3. (If you have kind) install the Helm chart  
4. Read NetworkPolicy templates — who can talk to whom?

**Can you explain?** Why the CronJob calls the API instead of keeping its own ledger?

### Day 8 — Terraform (cloud recipe)
1. Read `deploy/terraform/README.md`  
2. Skim `modules/vpc` → `security` → `compute` (order matters)  
3. `cd deploy/terraform` → `terraform init` → `terraform validate`  
4. Only if you accept AWS cost: copy `terraform.tfvars.example` → `plan` → (optional) `apply`  
5. Always `terraform destroy` when you stop learning on that box  

**Can you explain?** What does Terraform own vs what Docker Compose still owns?

### Day 9 — Ops proof (no AWS required)
1. Read `docs/runbooks/README.md` — pick Redis or ghost-spend  
2. Read one file in `docs/postmortems/`  
3. Skim `.github/workflows/cd-ghcr.yml` + `deploy/argocd/README.md`  
4. Paste CV bullets from `PORTFOLIO.md` into your resume  

**Can you explain?** Why a runbook is different from a postmortem?

## Commands cheat sheet

```bash
npm install
npm start              # API + dashboard + RAG ingest on boot
npm run demo           # bot farm ceiling
npm run demo:ghost     # leaked key
npm run demo:full      # whole story
npm run victim         # fake ResumeGlow app
npm run drill          # attack scenarios
npm test               # automated checks
npm run rag:ingest     # reload knowledge base
docker compose up --build
```

Kubernetes: see `deploy/README.md`.

## What is “full” vs later

**Included now:**
- Decision API, clustering, ledger, ghost spend, rules  
- RAG (local embeddings) + investigator/rule/wiring agents  
- SDK, victim app, dashboard, drills, tests  
- Docker Compose (Postgres + Redis + reconciler)  
- kind/Helm: Deployment, HPA, NetworkPolicy, CronJob, ingest Job  

**Included for IaC / ops learning:**
- `deploy/terraform/` — VPC + EC2 + SSM; optional RDS / ElastiCache / EKS flags  
- `deploy/argocd/` — GitOps Application for the Helm chart  
- `.github/workflows/cd-ghcr.yml` — push image to GHCR  
- `docs/postmortems/` + `docs/runbooks/` — ops proof  

**Still later (real production):**
- Always-on paid EKS with real traffic  
- Real OpenAI/Twilio usage connectors  
- Hosted embedding/rerank models  
- Multi-tenant hard isolation / KMS
