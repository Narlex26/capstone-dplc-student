# CI/CD — Pipeline GitHub Actions

Pipeline d'industrialisation de l'application Coupe du Monde 2026 sur le cluster
Kubernetes (k3s single-node, VPS Ikoula). Déploiement par **manifests Kubernetes bruts**
(`k8s/`) appliqués avec `kubectl`.

## Vue d'ensemble

```
  Développeur                 GitHub Actions                    VPS Ikoula (k3s)
  ───────────                 ──────────────                    ────────────────
   git push  ─────────────▶  ci.yml      (PR + push)
                              ├─ build image Docker
                              ├─ kubeconform (manifests k8s/)
                              └─ tests applicatifs (jest + PostgreSQL)

   merge main ────────────▶  deploy.yml  (push main)
                              ├─ build image ──▶ ghcr.io/alixsanta/worldcup-app:<sha>
                              ├─ scp des manifests ───────────▶ ~/worldcup-deploy/k8s (VPS)
                              └─ SSH ─────────────────────────▶ kubectl apply -f k8s/
                                                                 + kubectl set image (image du CI)
                                                                 k3s pull l'image ◀── GHCR

   bouton manuel ─────────▶  destroy.yml (workflow_dispatch)
                              └─ SSH ─────────────────────────▶ kubectl delete namespace worldcup
```

Couvre le cycle **create / update / destroy** :
- `kubectl apply` = **create** (1er déploiement) **et update** (déploiements suivants)
- `kubectl delete namespace worldcup` = **destroy** (tout part : pods, services, PVC, secret)

## Les 3 workflows

| Fichier | Déclencheur | Rôle |
|---------|-------------|------|
| `.github/workflows/ci.yml` | tout push + PR | **Bloquant** : build image Docker + validation des manifests (`kubeconform`) + tests applicatifs (jest + PostgreSQL). Ne déploie rien. |
| `.github/workflows/deploy.yml` | push sur `main` + manuel | Build → push image sur GHCR → copie des manifests sur le VPS (scp) → `kubectl apply` via SSH. |
| `.github/workflows/destroy.yml` | manuel (avec confirmation) | `kubectl delete namespace worldcup` sur le VPS. |

## Choix d'architecture (à défendre en soutenance)

- **Registry = GHCR** (`ghcr.io/alixsanta/worldcup-app`) : le push depuis le CI utilise
  un **PAT** (`write:packages`) stocké en GitHub Secret ; le pull par k3s est public.
- **Déploiement par SSH + kubectl** plutôt que kubeconfig exposé : l'API du cluster
  **reste privée**, le runner se contente d'ouvrir une session SSH. Moins de surface
  d'attaque, marche out-of-the-box avec k3s.
- **Manifests envoyés par scp** (pas de `git` sur le VPS) : le runner possède déjà le
  repo, il copie le dossier `k8s/` au moment du déploiement. Le VPS n'a besoin que de
  `kubectl` et du kubeconfig — pas de clone, pas de credentials git côté serveur.
- **Image injectée par le CI** : le manifest fixe une image par défaut, mais la pipeline
  l'écrase avec l'image qu'elle vient de construire (`kubectl set image ... <repo>:<sha>`).
  Chaque déploiement est traçable et reproductible (rollback = redéployer un ancien SHA).
- **Secret PostgreSQL géré nativement dans le cluster** (Kubernetes Secret
  `postgres-secret`, créé une fois à la main) : **pas de credentials en clair dans Git**
  ni dans GitHub. La pipeline n'y touche pas. *Contrepartie* : après un `destroy` qui
  supprime le namespace, recréer le secret à la main avant un nouveau déploiement
  (`kubectl create secret generic postgres-secret -n worldcup --from-literal=...`).
- **CI 100 % bloquante** : build Docker + `kubeconform` + tests applicatifs. Les
  générateurs des tests fournis avaient des défauts de non-déterminisme corrigés sans
  toucher au code applicatif (voir `docs/TESTS-FIXES.md`).

## Configuration requise (une seule fois)

### 1. Secrets GitHub
`Settings ▸ Secrets and variables ▸ Actions ▸ New repository secret` :

| Secret | Valeur |
|--------|--------|
| `VPS_HOST` | IP du VPS (`178.170.25.224`) |
| `VPS_USER` | utilisateur SSH dédié au déploiement (`deployer`) |
| `VPS_SSH_KEY` | **clé privée** SSH dédiée (avec en-têtes BEGIN/END) |
| `GHCR_USERNAME` | identifiant GitHub propriétaire du package (`alixsanta`) |
| `GHCR_TOKEN` | PAT avec scope `write:packages` |

> Le Secret PostgreSQL n'est **pas** dans GitHub : il est géré dans le cluster
> (Kubernetes Secret `postgres-secret`, créé une fois à la main).

> Clé SSH dédiée : `ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/worldcup_deploy -N ""`,
> puis ajouter `worldcup_deploy.pub` dans `~/.ssh/authorized_keys` du user `deployer` sur
> le VPS, et coller `worldcup_deploy` (la privée) dans `VPS_SSH_KEY`.

### 2. Sur le VPS (prérequis côté serveur)
- Un **utilisateur dédié** `deployer` (non-root, accès par clé uniquement).
- `kubectl` installé et disponible dans le PATH de `deployer`.
- Une **copie du kubeconfig k3s** lisible par `deployer` dans `~/.kube/config` :
  ```bash
  sudo mkdir -p /home/deployer/.kube
  sudo cp /etc/rancher/k3s/k3s.yaml /home/deployer/.kube/config
  sudo chown -R deployer:deployer /home/deployer/.kube
  sudo chmod 600 /home/deployer/.kube/config
  ```
- `metrics-server` actif (inclus par défaut dans k3s) → nécessaire pour le HPA.
- **Pas besoin de git, de Helm, ni de cloner le repo** : les manifests sont copiés par scp.

### 3. Visibilité de l'image GHCR
Après le 1er `deploy.yml`, le package apparaît dans
`github.com/<owner>?tab=packages`. Pour que k3s puisse le tirer sans secret :
**Package ▸ Settings ▸ Change visibility ▸ Public**.

## Les manifests (`k8s/`)

| Fichier | Ressource |
|---------|-----------|
| `namespace.yaml` | Namespace `worldcup` |
| `express-deployment.yaml` | App (2 réplicas, probes `/api/health/db`) |
| `express-service.yaml` | Service `svc-express` (ClusterIP) |
| `hpa.yaml` | Autoscaling CPU 50 % (2→6 réplicas) |
| `ingress.yaml` | Ingress Traefik (exposition internet) |
| `postgres-deployment.yaml` | PostgreSQL + init.sql (ConfigMap) |
| `postgres-service.yaml` | Service `svc-postgres` |
| `postgres-pvc.yaml` | Volume persistant 5Gi |
| `postgres-init-configmap.yaml` | ConfigMap `postgres-init-sql` |

> Le Secret `postgres-secret` n'est **pas** dans `k8s/` (pas de credentials dans git) :
> il est créé une fois à la main dans le cluster (`kubectl create secret generic
> postgres-secret -n worldcup --from-literal=POSTGRES_USER=... --from-literal=POSTGRES_PASSWORD=...
> --from-literal=POSTGRES_DB=...`).

## Démonstration en soutenance

```bash
# 1. UPDATE : un push sur main déclenche un redéploiement automatique
git commit --allow-empty -m "demo: trigger deploy" && git push

# 2. Suivre le pipeline : onglet Actions du repo GitHub

# 3. Vérifier sur le cluster
kubectl -n worldcup get pods,hpa,ingress

# 4. DESTROY : onglet Actions ▸ Destroy ▸ Run workflow ▸ taper "destroy"
```

## Validation locale des manifests

```bash
# Même validation que la CI
kubeconform -strict -summary -ignore-missing-schemas k8s/

# Déploiement manuel (équivalent de ce que fait la CI)
kubectl apply -f k8s/
kubectl set image deployment/express express=ghcr.io/alixsanta/worldcup-app:latest -n worldcup
```
