# Portfolio guide — BleedStop

## No AWS yet? (you can still demo everything that matters)

| Do now (free / local) | Needs AWS later |
|----------------------|-----------------|
| `npm` demos + dashboard + benchmark | `terraform apply` (EC2/VPC) |
| Docker Compose + Prometheus/Grafana | RDS / ElastiCache / EKS flags |
| kind + Helm | Paid always-on cloud |
| `terraform fmt` + `validate` | `terraform plan/apply` with keys |
| Argo CD on kind | EKS + Argo in cloud |
| Postmortems / runbooks on CV | Real cloud incident pages |

Terraform **code** still belongs on the CV: modules + CI `fmt`/`validate`. Just don’t claim “I run this on EKS in prod” until you do.

## CV — paste-ready (honest)

### Skills line
`Node.js · Express · Docker · Kubernetes (kind/Helm) · Terraform (AWS modules) · GitHub Actions (CI/CD) · Prometheus · Grafana · OpenTelemetry · Redis · Postgres · Python · Linux`

### Project bullets (BleedStop)
- Built a cost-abuse control plane (`ALLOW`/`LIMIT`/`DENY`) with cluster spend ceilings and ghost-spend reconcile for leaked vendor keys.
- Packaged for ops: Docker Compose, Helm chart (HPA, CronJob, NetworkPolicy), Prometheus metrics + Grafana dashboards + OTel traces.
- Authored Terraform modules for AWS staging (VPC, security groups, EC2 + SSM; optional RDS/ElastiCache/EKS behind feature flags).
- CI/CD: GitHub Actions for tests/evals, Terraform `fmt`/`validate` (+ optional plan), and GHCR image publish.
- GitOps-ready Argo CD Application for the Helm chart; operator runbooks + lab postmortems for Redis degradation and key-leak ghost spend.

### What not to write
- “Years of Terraform / on-call at FAANG” from this repo alone  
- “Production EKS” while you only have kind + Terraform code  

## One-line pitch

I built an abuse cost control plane that decides ALLOW/LIMIT/DENY before SMS/LLM spend, groups multi-account bots into one dollar ceiling, and kills leaked keys when vendor usage drifts from the app ledger.

## What to show in 3 minutes

1. Architecture sketch (hot path rules vs off-path agents)
2. `apps/protected-saas` middleware integration
3. `npm run benchmark` output table ($ without vs with)
4. Dashboard incident + investigator citations
5. Optional: Helm chart under `deploy/helm/bleedstop`  
6. Optional: Terraform + Argo CD + postmortems/runbooks (ops story)

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
| Terraform modules under `deploy/terraform/` (VPC/SG/EC2) | Paid always-on AWS if you forget `terraform destroy` |

## README snippet you can paste after benchmark

```md
### Benchmark (own staging app)
- OTP farm blocked after unpaid cluster ceiling
- Free AI abuse limited/denied under shared cluster bill
- Leaked-key ghost spend detected; key disabled
```

Paste the exact table printed by `npm run benchmark`.
