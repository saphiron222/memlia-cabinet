#!/usr/bin/env bash
set -euo pipefail
umask 077
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
: "${INSTALL_DIRECTORY:?Définir INSTALL_DIRECTORY}"
name="${1:-}"
[[ "$name" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$ ]] || { echo 'Nom de sauvegarde invalide.' >&2; exit 1; }
node deploy/preflight.mjs existing
mkdir "$INSTALL_DIRECTORY/.operation-lock" || { echo 'Une opération est en cours ; vérifier avant reprise manuelle.' >&2; exit 1; }
trap 'rmdir "$INSTALL_DIRECTORY/.operation-lock"' EXIT
compose=(docker compose --env-file "$INSTALL_DIRECTORY/compose.env" -f deploy/compose.yaml)
# Do not use compose stop's timeout/SIGKILL as evidence of a successful drain.
id="$("${compose[@]}" ps -q app)"
[[ -n "$id" ]] || { echo 'Application absente ; reprendre manuellement son état avant sauvegarde.' >&2; exit 1; }
docker kill --signal=SIGTERM "$id" >/dev/null
for ((i=0;i<120;i++)); do
  state="$(docker inspect --format '{{.State.Status}}' "$id")"
  [[ "$state" == exited ]] && break
  sleep 1
done
[[ "$state" == exited && "$(docker inspect --format '{{.State.ExitCode}}' "$id")" == 0 ]] || { echo 'Drainage non confirmé ; sauvegarde refusée, service à examiner.' >&2; exit 1; }
"${compose[@]}" run --rm --no-deps operations backup "/backups/$name"
"${compose[@]}" up -d --wait app
printf '%s\n' 'Sauvegarde capturée et contrôlée ; restauration de réception encore requise.'
