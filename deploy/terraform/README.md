# Terraform — BleedStop staging on AWS

### 🧩 What
**Terraform** is Infrastructure as Code (IaC).  
You write files that describe cloud boxes; Terraform creates/updates/destroys them.

### 🎯 Why we need it
Jobs ask for Terraform because clicking in the AWS console does not scale and cannot be reviewed in Git.  
This folder builds a **cheap staging host** that runs the same stack as `deploy/production/`.

### 🤝 How it helps
- CV / interviews: real `deploy/terraform/` with modules, not a buzzword  
- Repeatable: same VPC + EC2 every time  
- Safe defaults: encrypted disk, IMDSv2, SSM shell, optional SSH lock-down  

### ⚙️ How it works
Like a recipe:

1. `terraform plan` — show what would change (dry run)  
2. `terraform apply` — build VPC → security group → EC2 (+ Elastic IP)  
3. You deploy BleedStop with Docker Compose on that EC2  
4. `terraform destroy` — tear it down so you stop paying  

```
modules/vpc        → network (VPC, subnet, internet gateway)
modules/security   → firewall (80/443 open, SSH optional)
modules/compute    → Ubuntu EC2 + Docker via cloud-init + SSM role
```

**Default apply:** VPC + security group + EC2 (+ EIP/SSM). Matches Compose + Caddy.

**Optional extras** (all `false` by default — turn on in `terraform.tfvars`):

| Flag | Module | Notes |
|------|--------|-------|
| `enable_rds` | `modules/rds` | Managed Postgres; needs `rds_password` |
| `enable_elasticache` | `modules/elasticache` | Managed Redis |
| `enable_eks` | `modules/eks` | Small EKS + node group ($$$) |

Extras auto-create a **second public subnet** (2 AZs). Still **no NAT Gateway** (cheaper; staging trade-off).

---

## Cost warning (read this)

Rough ballpark for always-on staging (us-east-1, changes over time):

| Piece | Why |
|-------|-----|
| `t3.small` | App host |
| 30 GB gp3 | Disk |
| Elastic IP | Stable DNS target (free while attached to a running instance) |
| **No NAT Gateway** | Saves ~$30+/mo |

Turn it off when idle:

```bash
terraform destroy
```

---

## Prereqs

**Without AWS (still useful):**

```powershell
cd deploy/terraform
terraform init -backend=false
terraform fmt -recursive
terraform validate
```

**To create real cloud resources later:**

1. [Terraform](https://developer.hashicorp.com/terraform/install) `>= 1.5`  
2. AWS account + credentials (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`, or SSO)  
3. IAM permission to manage VPC, EC2, IAM roles, EIP  

---

## Commands

```powershell
cd deploy/terraform
copy terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars if you want a different region / size

terraform init
terraform fmt -recursive
terraform validate
terraform plan -out=plan.tfplan
terraform apply plan.tfplan
terraform output
```

After apply:

1. Point your domain’s **A record** at `public_ip`  
2. Open a shell: `terraform output -raw ssh_hint` (SSM)  
3. Put the repo in `/opt/bleedstop`  
4. Create `.env.production` (see `docs/PRODUCTION-READINESS.md`)  
5. Start Compose:

```bash
cd /opt/bleedstop
docker compose -f deploy/production/docker-compose.prod.yml --env-file .env.production up -d --build
```

Destroy when done learning:

```powershell
terraform destroy
```

---

## CI

`.github/workflows/terraform.yml`:

- always: `fmt` + `validate` (no AWS keys)  
- optional: `plan` when repo secrets `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` exist  

CD image push: `.github/workflows/cd-ghcr.yml` → `ghcr.io/<owner>/bleedstop`  
GitOps: `deploy/argocd/` (Helm sync).

---

## CV wording (honest)

> Authored Terraform modules (VPC, security groups, EC2 + SSM) for BleedStop AWS staging; Docker production compose runs on the provisioned host; `fmt`/`validate` gated in GitHub Actions.

Do **not** write “years of Terraform” from this alone.

---

## 🔁 Alternatives

| Option | When |
|--------|------|
| Only Docker Compose on a VPS | Faster, less IaC signal on CV |
| EKS + Helm | Stronger K8s story, higher cost/complexity |
| Pulumi / CDK | Same idea, different language — Terraform is what most postings name |
