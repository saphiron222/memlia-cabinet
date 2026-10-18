#!/usr/bin/env bash
set -euo pipefail
umask 077
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
: "${INSTALL_DIRECTORY:?Cible neuve préparée avec init, jamais démarrée}"
name="${1:-}"
[[ "$name" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$ ]] || { echo 'Nom de sauvegarde invalide.' >&2; exit 1; }
node deploy/preflight.mjs existing
node deploy/operations.mjs verify "$INSTALL_DIRECTORY/backups/$name"
mkdir "$INSTALL_DIRECTORY/.operation-lock" || { echo 'Une opération est en cours.' >&2; exit 1; }
trap 'rmdir "$INSTALL_DIRECTORY/.operation-lock"' EXIT
compose=(docker compose --env-file "$INSTALL_DIRECTORY/compose.env" -f deploy/compose.yaml)
[[ -z "$("${compose[@]}" ps -aq app)" ]] || { echo 'Cible déjà démarrée : restauration refusée.' >&2; exit 1; }
[[ -z "$(ls -A "$INSTALL_DIRECTORY/data")" && -z "$(ls -A "$INSTALL_DIRECTORY/postgres")" ]] || { echo 'Volumes non vides : restauration refusée.' >&2; exit 1; }
# Preserve installer configuration. Restore receives a new empty configuration directory.
[[ ! -e "$INSTALL_DIRECTORY/config-before-restore" ]] || exit 1
mv "$INSTALL_DIRECTORY/config" "$INSTALL_DIRECTORY/config-before-restore"
mkdir -m 700 "$INSTALL_DIRECTORY/config"
"${compose[@]}" up -d --wait postgres
"${compose[@]}" run --rm --no-deps operations restore "/backups/$name"
printf '%s\n' 'Restauration contrôlée. Configuration précédente conservée. Valider origine, accès et pièces avant install.sh start.'
