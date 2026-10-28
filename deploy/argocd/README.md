# Argo CD — GitOps for BleedStop Helm

### 🧩 What
**GitOps:** the cluster’s desired state lives in Git.  
**Argo CD** watches the repo and syncs the Helm chart.

### 🎯 Why
CV/interview signal: “not only kubectl apply — continuous sync from Git.”  
Works on **kind** (learning) or **EKS** (when `enable_eks=true`).

### ⚙️ How (kind quick path)

```powershell
# cluster already up from deploy/README Path B
kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

# wait until pods are ready, then:
kubectl apply -f deploy/argocd/app-bleedstop.yaml
```

`app-bleedstop.yaml` already points at `https://github.com/usmamalik345/bleedstop.git`.  
Change it only if you fork.

### Point at GHCR image

After CD pushes to `ghcr.io/<you>/bleedstop`, set Helm values (example):

```yaml
# in a values-gitops.yaml you own, or Argo parameters
image:
    repository: ghcr.io/usmamalik345/bleedstop
    tag: latest
```

### 🔁 Alternatives
- Plain `helm upgrade` (simpler, no GitOps controller)
- Flux instead of Argo CD (same idea)
