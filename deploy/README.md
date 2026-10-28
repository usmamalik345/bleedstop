# Deploy BleedStop (Docker + Kubernetes)

## Why Kubernetes here?

BleedStop traffic spikes during attacks. The Decision API must stay fast, while agents/reconciler stay isolated. Kubernetes gives:

- **HPA** — more API pods when CPU rises  
- **CronJob** — ghost-spend reconcile on a schedule  
- **Jobs** — RAG ingest / drills  
- **NetworkPolicies** — agents/workers cannot talk to random internet; API can talk to Redis/Postgres  

Start with **Docker Compose** or **kind**.  
For AWS staging boxes, use **Terraform** under `deploy/terraform/` (VPC + EC2 + Docker).  
Move to EKS later when revenue pays for it.

## Path A — Docker Compose (easiest full stack)

```bash
docker compose up --build
```

- API: http://localhost:3000/dashboard/  
- Postgres + Redis + reconciler worker included  

## Path B — kind + Helm (learn Kubernetes properly)

Prereqs: Docker, [kind](https://kind.sigs.k8s.io/), kubectl, Helm.

```powershell
# 1) Create cluster
kind create cluster --config deploy/kind/cluster.yaml

# 2) Build and load image
docker build -t bleedstop:local .
kind load docker-image bleedstop:local --name bleedstop

# 3) Install chart
helm upgrade --install bleedstop deploy/helm/bleedstop -n bleedstop-dev --create-namespace

# 4) Wait and open
kubectl -n bleedstop-dev get pods
# NodePort 30080 → http://localhost:30080/dashboard/
```

Useful:

```powershell
kubectl -n bleedstop-dev logs deploy/bleedstop-api
kubectl -n bleedstop-dev get cronjobs
kubectl -n bleedstop-dev create job --from=cronjob/bleedstop-reconciler manual-reconcile
helm uninstall bleedstop -n bleedstop-dev
kind delete cluster --name bleedstop
```

## Path C — Terraform AWS staging (IaC)

Creates a small VPC + Ubuntu EC2 (Docker pre-installed via cloud-init).  
You then run **Path A production compose** on that box.

```powershell
cd deploy/terraform
copy terraform.tfvars.example terraform.tfvars
terraform init
terraform plan
# terraform apply   # costs money — read deploy/terraform/README.md first
```

Full notes: `deploy/terraform/README.md`.

## Path D — Argo CD GitOps (optional)

```powershell
kubectl apply -f deploy/argocd/app-bleedstop.yaml
```

Edit `repoURL` first. See `deploy/argocd/README.md`.  
Pair with GHCR images from `.github/workflows/cd-ghcr.yml`.

## What runs where

| Component | Compose | Kubernetes | Terraform staging |
|-----------|---------|------------|-------------------|
| Decision API | `bleedstop` service | Deployment + Service + HPA | Same Compose on EC2 |
| Reconciler | `reconciler` service | CronJob → calls API `/reconcile` | Same Compose on EC2 |
| RAG ingest | on API boot + `/rag/ingest` | Helm Job + API endpoint | Same Compose on EC2 |
| Postgres | `postgres` | Deployment (dev) / RDS later | Compose on EC2 (RDS later) |
| Redis | `redis` | Deployment (dev) / ElastiCache later | Compose on EC2 (later) |
| Agents | API routes `/investigate`, `/agents/*` | Same API pods (off hot path) | Same |
| Cloud network | — | kind local | VPC + SG + EIP |

## Security notes (learning)

- NetworkPolicies default-deny in the namespace  
- Pods run as non-root (`USER node`)  
- Secrets via K8s Secret (dev passwords only — rotate for real)  
- Agents never decide `/decide` outcomes  
