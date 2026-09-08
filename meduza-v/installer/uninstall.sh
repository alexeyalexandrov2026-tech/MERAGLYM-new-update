#!/usr/bin/env bash
# Meduza V - remove the local installation.
#
# By default this stops and removes the containers but KEEPS your data and
# configuration, so re-running install.sh brings the same shop back.
#
#   ./installer/uninstall.sh              remove containers, keep data
#   ./installer/uninstall.sh --purge      also delete the database and .env

set -Eeuo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

PURGE=0
for arg in "$@"; do
  case "$arg" in
    --purge) PURGE=1 ;;
    -h|--help) sed -n '2,9p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [ "$PURGE" -eq 1 ]; then
  echo
  echo "This permanently deletes the database (all orders and products)."
  echo "Backups in ./backups are kept."
  printf 'Type DELETE to confirm: '
  read -r reply
  if [ "$reply" != "DELETE" ]; then echo "Cancelled."; exit 1; fi
  docker compose down --volumes --remove-orphans
  rm -f .env
  echo "Removed containers, database volume and .env."
else
  docker compose down --remove-orphans
  echo "Removed containers. Data and .env are kept; run install.sh to start again."
fi
