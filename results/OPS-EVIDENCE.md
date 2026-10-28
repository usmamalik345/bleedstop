# Ops evidence index (no AWS required)

Links recruiters / interviewers can open in this repo:

| Proof | Where |
|-------|--------|
| Scale / ceiling | [SCALE-RESULTS.md](./SCALE-RESULTS.md) |
| K8s rollout under load | [INFRA-RESULTS.md](./INFRA-RESULTS.md) |
| Multi-instance race | [MULTI-INSTANCE-REPORT.md](./MULTI-INSTANCE-REPORT.md) |
| Load / latency | [LOADTEST-REPORT.md](./LOADTEST-REPORT.md) |
| Lab postmortems | [../docs/postmortems/](../docs/postmortems/) |
| Operator runbooks | [../docs/runbooks/](../docs/runbooks/) |
| Terraform modules | [../deploy/terraform/](../deploy/terraform/) |
| Helm chart | [../deploy/helm/bleedstop/](../deploy/helm/bleedstop/) |
| Prometheus / Grafana stack | [../deploy/observability/](../deploy/observability/) |
| Argo CD app | [../deploy/argocd/](../deploy/argocd/) |
| CI | `.github/workflows/ci.yml` |
| Terraform CI | `.github/workflows/terraform.yml` |
| Image CD (GHCR) | `.github/workflows/cd-ghcr.yml` |

**Local Grafana (screenshot for interviews):**

```powershell
docker compose -f deploy/observability/docker-compose.yml up -d
# open http://localhost:3001  (check compose file for exact port)
```

AWS `terraform apply` is optional later — code + CI validate already land without a cloud account.
