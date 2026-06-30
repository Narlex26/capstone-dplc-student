# CI/CD — Pipeline GitHub Actions

Pipeline d'industrialisation de l'application Coupe du Monde 2026 sur le cluster
Kubernetes (k3s single-node, VPS Ikoula).

## Vue d'ensemble

```
  Développeur                 GitHub Actions                    VPS Ikoula (k3s)
  ───────────                 ──────────────                    ────────────────
   git push  ─────────────▶  ci.yml      (PR + push)
                              ├─ jest + PostgreSQL
                              └─ docker build (validation)

   merge main ────────────▶  deploy.yml  (push main)
                              ├─ docker build
                              ├─ push image ──▶ ghcr.io/<owner>/<repo>:<sha>
                              └─ SSH ─────────────────────────▶ helm upgrade --install
                                                                 (k3s : 2 pods + HPA + Ingress + Postgres)

   bouton manuel ─────────▶  destroy.yml (workflow_dispatch)
                              └─ SSH ─────────────────────────▶ helm uninstall
```

Couvre le cycle **create / update / destroy** exigé par la grille :
- `helm upgrade --install` = **create** (1er déploiement) **et update** (déploiements suivants)
- `helm uninstall` = **destroy**

## Les 3 workflows

| Fichier | Déclencheur | Rôle |
|---------|-------------|------|
| `.github/workflows/ci.yml` | tout push + PR | Tests jest (avec service PostgreSQL) + validation du build Docker. Ne déploie rien. |
| `.github/workflows/deploy.yml` | push sur `main` + manuel | Build → push image sur GHCR → `helm upgrade --install` sur le VPS via SSH. |
| `.github/workflows/destroy.yml` | manuel (avec confirmation) | `helm uninstall` sur le VPS. |

## Choix d'architecture (à défendre en soutenance)

- **Registry = GHCR** (`ghcr.io`) : intégré à GitHub, authentifié par le `GITHUB_TOKEN`
  automatique → **aucun secret de registre à gérer**.
- **Déploiement par SSH + Helm** plutôt que kubeconfig exposé : l'API du cluster
  **reste privée**, le runner se contente d'ouvrir une session SSH. Moins de surface
  d'attaque, marche out-of-the-box avec k3s.
- **Image taguée par le SHA du commit** : chaque déploiement est traçable et
  reproductible (rollback = redéployer un ancien SHA).
- **`--atomic`** : en cas d'échec du déploiement, Helm rollback automatiquement →
  pas de cluster laissé dans un état cassé.
- **Pas de credentials en clair dans Git** : tout passe par les *GitHub Secrets* et
  un *Secret* Kubernetes (critère Sécurité de la grille).

## Configuration requise (une seule fois)

### 1. Secrets GitHub
`Settings ▸ Secrets and variables ▸ Actions ▸ New repository secret` :

| Secret | Valeur | Exemple |
|--------|--------|---------|
| `VPS_HOST` | IP ou domaine du VPS | `51.x.x.x` |
| `VPS_USER` | utilisateur SSH (accès au kubeconfig k3s) | `root` ou `debian` |
| `VPS_SSH_KEY` | **clé privée** SSH complète (avec en-têtes BEGIN/END) | contenu de `~/.ssh/id_ed25519` |

> Générer une paire dédiée : `ssh-keygen -t ed25519 -f deploy_key -N ""`, ajouter
> `deploy_key.pub` dans `~/.ssh/authorized_keys` du VPS, et coller `deploy_key`
> (la privée) dans `VPS_SSH_KEY`.

### 2. Sur le VPS (prérequis côté serveur)
- `git`, `helm` et `kubectl` installés, repo cloné dans `~/capstone-dplc-student`
  (sinon définir la variable d'env `VPS_REPO_PATH`).
- Le user SSH peut lire `/etc/rancher/k3s/k3s.yaml` (kubeconfig de k3s).
- `metrics-server` actif (inclus par défaut dans k3s) → nécessaire pour le HPA.

### 3. Visibilité de l'image GHCR
Après le 1er `deploy.yml`, le package apparaît dans
`github.com/<owner>?tab=packages`. Pour que k3s puisse la tirer sans secret :
**Package ▸ Settings ▸ Change visibility ▸ Public**.
(Sinon : passer `imagePullSecrets.enabled=true` dans le chart et créer le secret
`ghcr-creds` côté cluster.)

## Démonstration en soutenance

```bash
# 1. UPDATE : un push sur main déclenche un redéploiement automatique
git commit --allow-empty -m "demo: trigger deploy" && git push

# 2. Suivre le pipeline
#    onglet Actions du repo GitHub

# 3. Vérifier sur le cluster
kubectl -n worldcup get pods,hpa,ingress

# 4. DESTROY : onglet Actions ▸ Destroy ▸ Run workflow ▸ taper "destroy"
```

## Test rapide en local

```bash
# Rendu du chart sans l'appliquer
helm template worldcup ./helm/worldcup

# Déploiement manuel (équivalent de ce que fait la CI)
helm upgrade --install worldcup ./helm/worldcup \
  --namespace worldcup --create-namespace \
  --set app.image.repository=ghcr.io/<owner>/<repo> \
  --set app.image.tag=latest
```
