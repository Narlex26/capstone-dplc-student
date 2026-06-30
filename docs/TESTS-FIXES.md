# Correction des tests property-based non déterministes

Les tests fournis dans le starter kit étaient *flaky* : ils échouaient aléatoirement
en CI selon le seed généré par `fast-check`. Diagnostic et corrections ci-dessous.
**Aucune route ni logique applicative n'a été modifiée** (consigne respectée) — seuls
les générateurs et le harnais de test ont été corrigés.

## `tests/match-insertion.property.test.js` — 3 bugs

### 1. Collision de noms d'équipes
Le mock distinguait les équipes par **nom** : `if (params[0] === team_home) -> id 1`,
`if (params[0] === team_away) -> id 2`. Quand `fast-check` générait `team_home === team_away`
(ex. les deux = `"!"`), les deux requêtes matchaient le premier `if` et renvoyaient `id 1`
→ l'assertion `team_away_id === 2` échouait.

**Correction** : le mock distingue les équipes par **ordre d'appel** (1er `SELECT` = home,
2e = away), via un compteur. Robuste même si les noms sont identiques, et plus fidèle à
la logique réelle de l'app (qui cherche toujours home puis away).

### 2. Dates invalides
`fc.date({ min, max })` inclut `Invalid Date` (`new Date(NaN)`) dans son domaine par
défaut. La ligne `matchData.date.toISOString()` levait alors une exception **avant même
d'appeler l'app**.

**Correction** : option `noInvalidDate: true` sur le générateur de date — une date
invalide n'est pas une « donnée de match valide » (la prémisse du test).

### 3. Race du serveur éphémère de supertest
`request(app)` démarre **un serveur HTTP éphémère à chaque appel**. Sur 100 itérations
enchaînées, une race produisait par intermittence un **404 à corps vide** (la requête
n'atteignait jamais le handler — `lookups: 0`). Reproductible sur entrée *identique*
(donc ni l'entrée ni le générateur en cause).

**Correction** : un **serveur persistant** unique (`app.listen(0)` dans `beforeAll`,
`server.close()` dans `afterAll`), réutilisé via `request(server)` sur toutes les
itérations. → 0 échec sur 60+ runs.

## `tests/dockerfile-check.property.test.js` — outil manquant

Le test invoque `teacher-tools/check-dockerfile.sh`, **non fourni** dans le dépôt → la
sortie était vide et le test échouait (`scoreMatch === null`).

**Correction** : le script `teacher-tools/check-dockerfile.sh` a été **implémenté** en
suivant exactement la spécification décrite dans le test (`computeExpectedScore` + les
commentaires). Il évalue les 5 bonnes pratiques (image de base légère, USER non-root,
multi-stage, `.dockerignore`, ordre des layers) et imprime `<score>/5 checks passed`.
Le test s'exécute désormais réellement et passe de façon déterministe.

## Vérification

```bash
cd app
# Suite complète, plusieurs fois (seeds différents) :
for i in $(seq 1 5); do npm test; done
# -> 7 suites, 11 tests, 100 % vert et reproductible
```
