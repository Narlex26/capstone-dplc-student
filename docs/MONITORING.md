# Observabilité — Prometheus + Grafana

Stack de monitoring déployée sur le cluster k3s, namespace `monitoring`.
Manifests dans `k8s/monitoring/`.

## Accès

| Interface | URL | Identifiants |
|-----------|-----|--------------|
| **Grafana** (dashboard) | http://178.170.25.224:30030 | user `admin` — mot de passe dans le Secret `grafana-admin` (créé hors git) |
| **Prometheus** (métriques brutes / alertes) | http://178.170.25.224:30090 | — |

## Ce qui est en place

- **Prometheus** scrape les métriques de l'application via la **découverte Kubernetes**
  (`kubernetes_sd_configs`, role `endpoints`) → il découvre et scrape **les 2 pods
  express** individuellement (label `pod`), sur `/metrics`.
- **Grafana** avec :
  - la **datasource Prometheus auto-provisionnée** (uid `prometheus`) ;
  - un **dashboard auto-provisionné** « WorldCup 2026 — Observabilité » :
    requêtes HTTP/s, latence p95, mémoire résidente par pod, pods `UP`.
- **Règles d'alerte** Prometheus (`k8s/monitoring/prometheus.yaml`) :
  - `ExpressPodDown` — un pod express ne répond plus (`up == 0`) ;
  - `ExpressHighErrorRate` — taux d'erreurs 5xx élevé ;
  - `ExpressHighLatency` — latence p95 > 1s.
  Visibles dans Prometheus → onglet **Alerts**.

## Métriques exposées par l'app (`/metrics`)

- `http_requests_total{method,status_code}` — compteur de requêtes
- `http_request_duration_seconds{route}` — histogramme de latence
- métriques par défaut Node.js (`process_cpu_seconds_total`,
  `process_resident_memory_bytes`, `nodejs_heap_size_used_bytes`…)

## Déploiement

Le monitoring est déployé **une fois** (infra stable, hors pipeline applicative) :

```bash
# 1. Secret admin Grafana (hors git)
kubectl create secret generic grafana-admin -n monitoring \
  --from-literal=admin-user=admin --from-literal=admin-password='<mot-de-passe>'

# 2. Manifests
kubectl apply -f k8s/monitoring/
```

## Vérifications utiles

```bash
# Cibles scrappées (les 2 pods express doivent être UP)
curl -s 'http://localhost:30090/api/v1/query?query=up{job="express"}'

# Pods du monitoring
kubectl get pods -n monitoring
```

## Trade-off de sécurité (assumé)

Prometheus et Grafana sont exposés en **NodePort** sur internet pour faciliter la démo.
Grafana est protégé par authentification ; **Prometheus n'a pas d'authentification**
(métriques + API lisibles sans login). Assumé pour le capstone : projet temporaire,
données non sensibles (stats de matchs/votes publics). *Durcissement possible* : passer
Prometheus en `ClusterIP` (accès via `kubectl port-forward`), ou filtrer le NodePort au
niveau firewall.

## Démo en soutenance

1. Ouvrir Grafana → dashboard « WorldCup 2026 — Observabilité ».
2. Générer de la charge (`hey`/`ab` sur `/api/compute`) → voir les courbes bouger.
3. Tuer un pod (`/api/admin/kill`) → voir un pod passer `DOWN` puis remonter, et
   l'alerte `ExpressPodDown` s'armer dans Prometheus.
