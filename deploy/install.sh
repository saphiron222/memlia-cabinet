#!/usr/bin/env bash
set -euo pipefail
umask 077
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
command -v node >/dev/null || { echo 'Node 22.22 ou supérieur requis.' >&2; exit 1; }
command -v docker >/dev/null || { echo 'Docker et Compose requis.' >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo 'Service Docker indisponible ; aucune installation modifiée.' >&2; exit 1; }
docker compose version >/dev/null
: "${INSTALL_DIRECTORY:?Définir INSTALL_DIRECTORY hors du dépôt}"
case "${1:-}" in
  init) node deploy/preflight.mjs init ;;
  start|stop|status)
    node deploy/preflight.mjs existing
    case "$1" in
      start) docker compose --env-file "$INSTALL_DIRECTORY/compose.env" -f deploy/compose.yaml up -d --build --wait postgres app ;;
      stop) docker compose --env-file "$INSTALL_DIRECTORY/compose.env" -f deploy/compose.yaml stop -t 120 app postgres ;;
      status) docker compose --env-file "$INSTALL_DIRECTORY/compose.env" -f deploy/compose.yaml ps ;;
    esac ;;
  *) echo 'Usage : INSTALL_DIRECTORY=/chemin/prive deploy/install.sh init|start|stop|status' >&2; exit 1 ;;
esac
