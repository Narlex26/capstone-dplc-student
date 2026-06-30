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
                              ├─ scp du chart Helm ───────────▶ ~/worldcup-deploy/ (VPS)
                              └─ SSH ─────────────────────────▶ helm upgrade --install
                                                                 (k3s : 2 pods + HPA + Ingress + Postgres)
                                                                 k3s pull l'image ◀── GHCR

   bouton manuel ─────────▶  destroy.yml (workflow_dispatch)
                              └─ SSH ─────────────────────────▶ helm uninstall
```

Couvre le cycle **create / update / destroy** exigé par la grille :
- `helm upgrade --install` = **create** (1er déploiement) **et update** (déploiements suivants)
- `helm uninstall` = **destroy**

## Les 3 workflows

| Fichier | Déclencheur | Rôle |
|---------|-------------|------|
| `.github/workflows/ci.yml` | tout push + PR | **Bloquant** : build image Docker + validation chart Helm (`helm lint`/`template`) + tests applicatifs (jest + PostgreSQL). Ne déploie rien. |
| `.github/workflows/deploy.yml` | push sur `main` + manuel | Build → push image sur GHCR → copie du chart sur le VPS (scp) → `helm upgrade --install` via SSH. |
| `.github/workflows/destroy.yml` | manuel (avec confirmation) | `helm uninstall` sur le VPS. |

## Choix d'architecture (à défendre en soutenance)

- **Registry = GHCR** (`ghcr.io`) : intégré à GitHub, authentifié par le `GITHUB_TOKEN`
  automatique → **aucun secret de registre à gérer**.
- **Déploiement par SSH + Helm** plutôt que kubeconfig exposé : l'API du cluster
  **reste privée**, le runner se contente d'ouvrir une session SSH. Moins de surface
  d'attaque, marche out-of-the-box avec k3s.
- **Chart envoyé par scp** (pas de `git` sur le VPS) : le runner possède déjà le repo,
  il copie le chart Helm au moment du déploiement. Le VPS n'a besoin que de `helm`,
  `kubectl` et du kubeconfig — pas de clone, pas de credentials git côté serveur.
- **Séparation image / chart** : l'**image** (l'artefact applicatif) transite par GHCR ;
  le **chart Helm** (la recette de déploiement) est copié sur le VPS. Helm lit le chart
  localement et k3s tire l'image depuis GHCR.
- **Image taguée par le SHA du commit** : chaque déploiement est traçable et
  reproductible (rollback = redéployer un ancien SHA).
- **`--atomic`** : en cas d'échec du déploiement, Helm rollback automatiquement →
  pas de cluster laissé dans un état cassé.
- **Pas de credentials en clair dans Git** : tout passe par les *GitHub Secrets* et
  un *Secret* Kubernetes (critère Sécurité de la grille).
- **CI 100 % bloquante** : trois jobs verrouillent le pipeline — build de l'image
  Docker, validation du chart Helm (`helm lint` + `helm template`) et tests applicatifs
  property-based. Les générateurs de tests fournis avaient des défauts de
  non-déterminisme (dates `Invalid Date`, collisions de noms d'équipes, race du serveur
  éphémère de `supertest`) qui ont été corrigés sans toucher au code applicatif — les
  routes restent intactes. Voir `docs/TESTS-FIXES.md` pour le détail des corrections.

## Configuration requise (une seule fois)

### 1. Secrets GitHub
`Settings ▸ Secrets and variables ▸ Actions ▸ New repository secret` :

| Secret | Valeur | Exemple |
|--------|--------|---------|
| `VPS_HOST` | IP ou domaine du VPS | `51.x.x.x` |
| `VPS_USER` | utilisateur SSH dédié au déploiement | `deployer` |
| `VPS_SSH_KEY` | **clé privée** SSH dédiée (avec en-têtes BEGIN/END) | contenu de `~/.ssh/worldcup_deploy` |

> Générer une paire dédiée : `ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/worldcup_deploy -N ""`,
> ajouter `worldcup_deploy.pub` dans `~/.ssh/authorized_keys` du user `deployer` sur le
> VPS, et coller `worldcup_deploy` (la privée) dans `VPS_SSH_KEY`.

### 2. Sur le VPS (prérequis côté serveur)
- Un **utilisateur dédié** `deployer` (non-root, accès par clé uniquement).
- `helm` et `kubectl` installés et disponibles dans le PATH de `deployer`.
- Une **copie du kubeconfig k3s** lisible par `deployer` dans `~/.kube/config` :
  ```bash
  sudo mkdir -p /home/deployer/.kube
  sudo cp /etc/rancher/k3s/k3s.yaml /home/deployer/.kube/config
  sudo chown -R deployer:deployer /home/deployer/.kube
  sudo chmod 600 /home/deployer/.kube/config
  ```
- `metrics-server` actif (inclus par défaut dans k3s) → nécessaire pour le HPA.
- **Pas besoin de git ni de cloner le repo** : le chart est copié par scp à chaque déploiement.

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
