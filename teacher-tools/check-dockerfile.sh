#!/usr/bin/env bash
# check-dockerfile.sh — Évalue 5 bonnes pratiques d'un Dockerfile.
#
# Usage  : check-dockerfile.sh <chemin/vers/Dockerfile>
# Sortie : "<score>/5 checks passed"
#
# Les 5 vérifications (alignées sur tests/dockerfile-check.property.test.js) :
#   1. Image de base légère à version figée (node:<v>-alpine|slim, pas node:latest) — dernier FROM
#   2. Utilisateur non-root (instruction USER, différente de root)
#   3. Build multi-stage (>= 2 instructions FROM)
#   4. Présence d'un .dockerignore dans le même dossier
#   5. Ordre des layers : 1er COPY *package < 1er RUN npm install|ci < dernier COPY . .
set -euo pipefail

DOCKERFILE="${1:?usage: check-dockerfile.sh <Dockerfile>}"
DIR="$(dirname "$DOCKERFILE")"
score=0

# Check 1 — Image de base : dernier FROM en node:<version>-(alpine|slim), hors node:latest
last_from="$(grep -iE '^[[:space:]]*FROM[[:space:]]' "$DOCKERFILE" | tail -1 || true)"
if printf '%s' "$last_from" | grep -qiE 'node:[0-9]+[^[:space:]]*-(alpine|slim)'; then
  score=$((score + 1))
fi

# Check 2 — Utilisateur non-root : une instruction USER, qui n'est pas root
user_line="$(grep -iE '^[[:space:]]*USER[[:space:]]' "$DOCKERFILE" || true)"
if [ -n "$user_line" ] && ! printf '%s' "$user_line" | grep -qiE '^[[:space:]]*USER[[:space:]]+root[[:space:]]*$'; then
  score=$((score + 1))
fi

# Check 3 — Multi-stage : au moins 2 instructions FROM
from_count="$(grep -icE '^[[:space:]]*FROM[[:space:]]' "$DOCKERFILE" || true)"
if [ "${from_count:-0}" -ge 2 ]; then
  score=$((score + 1))
fi

# Check 4 — .dockerignore présent dans le même dossier que le Dockerfile
if [ -f "$DIR/.dockerignore" ]; then
  score=$((score + 1))
fi

# Check 5 — Ordre des layers (évalué globalement sur tout le fichier) :
#   1er COPY *package < 1er RUN npm install|ci < dernier COPY . .
copy_pkg="$(grep -niE '^[[:space:]]*COPY[[:space:]].*package' "$DOCKERFILE" | head -1 | cut -d: -f1 || true)"
npm_run="$(grep -niE '^[[:space:]]*RUN[[:space:]].*(npm install|npm ci)' "$DOCKERFILE" | head -1 | cut -d: -f1 || true)"
copy_all="$(grep -niE '^[[:space:]]*COPY[[:space:]]+\.[[:space:]]+\.' "$DOCKERFILE" | tail -1 | cut -d: -f1 || true)"
if [ -n "$copy_pkg" ] && [ -n "$npm_run" ] && [ -n "$copy_all" ] \
   && [ "$copy_pkg" -lt "$npm_run" ] && [ "$npm_run" -lt "$copy_all" ]; then
  score=$((score + 1))
fi

echo "${score}/5 checks passed"
