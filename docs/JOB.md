# Job créatif — Snapshot des tendances de vote

## Objectif

Un **CronJob Kubernetes** qui, à intervalle régulier, lit la base de données et
enregistre un **instantané horodaté du classement des votes** dans une table dédiée
`vote_trends`. Cela transforme une donnée instantanée (le classement actuel) en une
**série temporelle** : on peut suivre l'**évolution des pronostics dans le temps**.

Manifest : `k8s/vote-trends-cronjob.yaml` — déployé dans le namespace `worldcup`
(et appliqué par la pipeline, puisqu'il est dans `k8s/`).

## Design

```
        ┌──────────────────────────┐
        │  CronJob (*/5 * * * *)    │   planification Kubernetes
        └────────────┬─────────────┘
                     │ crée un Job à chaque tick
                     ▼
        ┌──────────────────────────┐
        │  Pod postgres:15-alpine  │   conteneur éphémère (psql)
        │  identifiants: Secret    │◀── postgres-secret (mêmes creds que l'app)
        │  postgres-secret         │
        └────────────┬─────────────┘
                     │ SELECT teams + votes
                     ▼
        ┌──────────────────────────┐
        │  PostgreSQL (svc-postgres)│
        │  INSERT INTO vote_trends │   1 ligne par équipe votée, horodatée
        └──────────────────────────┘
```

- **Déclencheur** : planifié (CRON, toutes les 5 min — ajustable). Déclenchable
  manuellement aussi (`kubectl create job --from=cronjob/...`).
- **Lecture BDD** : jointure `teams` × `votes`, agrégation des votes par équipe.
- **Écriture BDD** : insertion d'un snapshot dans `vote_trends`.
- **Sécurité** : aucune credential en dur — le pod lit `postgres-secret` (le même
  Secret que l'application).
- **Robustesse** : `concurrencyPolicy: Forbid` (pas de chevauchement),
  `restartPolicy: Never`, `backoffLimit: 2`, historique limité (3 succès / 3 échecs).

## Schéma de la table produite

```sql
CREATE TABLE vote_trends (
  id          SERIAL PRIMARY KEY,
  snapshot_at TIMESTAMP NOT NULL DEFAULT NOW(),   -- horodatage du snapshot
  team_id     INTEGER NOT NULL,
  team_name   VARCHAR(100) NOT NULL,
  votes       INTEGER NOT NULL,                    -- nb de votes à cet instant
  percentage  NUMERIC(5,2) NOT NULL                -- part relative (%)
);
```

Chaque exécution ajoute un lot de lignes partageant le même `snapshot_at` → l'historique
des `snapshot_at` donne la courbe d'évolution de chaque équipe.

## Démo / vérification

```bash
# Générer des votes
curl -X POST http://178.170.25.224/api/vote -H 'Content-Type: application/json' -d '{"team_id": 33}'

# Déclencher le job sans attendre le CRON
kubectl create job --from=cronjob/vote-trends-snapshot vote-trends-run -n worldcup

# Voir ce qu'il a fait (top 5 imprimé dans les logs)
kubectl logs job/vote-trends-run -n worldcup

# État du CronJob
kubectl get cronjob -n worldcup
```

Exemple de sortie observée :

```
 team_name | votes | percentage
-----------+-------+------------
 France    |     3 |      42.86
 Brazil    |     2 |      28.57
 Mexico    |     1 |      14.29
 Germany   |     1 |      14.29
```

## Évolutions possibles (pistes soutenance)

- Exposer l'historique via un endpoint / un panneau Grafana (courbe des votes par équipe).
- Passer d'un CRON à un déclenchement **événementiel** (ex. après chaque vote, via une
  file/queue).
- Ajouter une rétention (purge des snapshots > N jours).
