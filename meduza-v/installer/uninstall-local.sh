#!/usr/bin/env bash
# Meduza V — remove the local (no-Docker) install.
#
#   ./installer/uninstall-local.sh           stop it, keep your data
#   ./installer/uninstall-local.sh --purge   also delete the database and .env
#
# Without --purge this leaves meduza-local.db and .env alone, so re-running
# install-local.sh brings the same shop back with the same orders.

set -Eeuo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PURGE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --purge) PURGE=1 ;;
    -h|--help) sed -n '2,9p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac; shift
done

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  BOLD=$'\033[1m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; OFF=$'\033[0m'
else BOLD=""; GREEN=""; YELLOW=""; OFF=""; fi
step(){ printf '%s==>%s %s\n' "$BOLD" "$OFF" "$1"; }
ok(){ printf '    %s+%s %s\n' "$GREEN" "$OFF" "$1"; }
warn(){ printf '    %s!%s %s\n' "$YELLOW" "$OFF" "$1"; }

cd "$PROJECT_ROOT"
printf '\n%sMeduza V — removing the local install%s\n\n' "$BOLD" "$OFF"

step "Stopping the shop"
stopped=0
# Prefer the PIDs the installer recorded; fall back to matching on the project
# directory, which still never touches an unrelated uvicorn.
if [ -f .meduza-local.pid ]; then
  while read -r pid; do
    case "$pid" in ''|*[!0-9]*) continue ;; esac
    kill "$pid" 2>/dev/null && stopped=$((stopped + 1)) || true
  done < .meduza-local.pid
fi
for pid in $(pgrep -f "$PROJECT_ROOT/.venv/bin/(uvicorn|python)" 2>/dev/null || true); do
  kill "$pid" 2>/dev/null && stopped=$((stopped + 1)) || true
done
[ "$stopped" -gt 0 ] && ok "stopped $stopped process(es)" || ok "nothing was running"

step "Removing generated files"
for f in .venv start-local.sh server.log worker.log .meduza-local.pid; do
  [ -e "$f" ] && { rm -rf "$f"; ok "removed $f"; }
done

if [ "$PURGE" -eq 1 ]; then
  step "Purging data and configuration"
  for f in meduza-local.db meduza-local.db-wal meduza-local.db-shm .env; do
    [ -e "$f" ] && { rm -f "$f"; ok "deleted $f"; }
  done
  printf '\n%sRemoved, including your orders and configuration.%s\n\n' "$GREEN" "$OFF"
else
  step "Keeping your data"
  [ -e meduza-local.db ] && ok "kept meduza-local.db (your orders)" || true
  [ -e .env ] && ok "kept .env (your admin key and settings)" || true
  warn "add --purge to delete these as well"
  printf '\n%sRemoved. Re-run installer/install-local.sh to bring it back.%s\n\n' "$GREEN" "$OFF"
fi
