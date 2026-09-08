#!/usr/bin/env bash
# Meduza V — one-command installer for Linux and macOS.
#
# Brings up the whole stack (PostgreSQL, Redis, web, worker, backups) with
# Docker, generates the secrets a first run needs, applies migrations, loads the
# sample catalog and waits until the service answers its own health check.
#
# Safe to re-run: an existing .env is never overwritten, and the catalog seed
# is idempotent.
#
#   ./installer/install.sh              install or update
#   ./installer/install.sh --rebuild    force a clean image rebuild
#   ./installer/install.sh --no-seed    skip the sample catalog

set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="Meduza V"
APP_URL="http://localhost:8000"
HEALTH_TIMEOUT=180

REBUILD=0
SEED=1
for arg in "$@"; do
  case "$arg" in
    --rebuild) REBUILD=1 ;;
    --no-seed) SEED=0 ;;
    -h|--help) sed -n '2,14p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  BOLD=$'\033[1m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; DIM=$'\033[2m'; OFF=$'\033[0m'
else
  BOLD=""; GREEN=""; YELLOW=""; RED=""; DIM=""; OFF=""
fi
step() { printf '%s==>%s %s\n' "$BOLD" "$OFF" "$1"; }
ok()   { printf '    %s+%s %s\n' "$GREEN" "$OFF" "$1"; }
warn() { printf '    %s!%s %s\n' "$YELLOW" "$OFF" "$1"; }
die()  { printf '\n%serror:%s %s\n' "$RED" "$OFF" "$1" >&2; exit 1; }

# Generate a URL-safe random secret. 36 bytes -> 48 characters, comfortably
# over the 32-character minimum config.py enforces in production.
new_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 36 | tr '+/' '-_' | tr -d '=\n'
  else
    head -c 36 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n'
  fi
}

# Replace `KEY=anything` with `KEY=value`, leaving the rest of the file alone.
set_env_value() {
  local file="$1" key="$2" value="$3"
  python3 - "$file" "$key" "$value" <<'PY'
import pathlib, re, sys
path, key, value = sys.argv[1], sys.argv[2], sys.argv[3]
p = pathlib.Path(path)
lines = p.read_text().splitlines()
pattern = re.compile(rf"^{re.escape(key)}=")
for i, line in enumerate(lines):
    if pattern.match(line):
        lines[i] = f"{key}={value}"
        break
else:
    lines.append(f"{key}={value}")
p.write_text("\n".join(lines) + "\n")
PY
}

cd "$PROJECT_ROOT"
printf '\n%s%s installer%s\n%s%s%s\n\n' "$BOLD" "$APP_NAME" "$OFF" "$DIM" "$PROJECT_ROOT" "$OFF"

# --------------------------------------------------------------------------
step "Checking prerequisites"
command -v docker >/dev/null 2>&1 || die \
  "Docker is not installed.
    Install Docker Engine (Linux) or Docker Desktop (macOS):
    https://docs.docker.com/get-docker/"
docker compose version >/dev/null 2>&1 || die \
  "Docker Compose v2 is not available.
    Update Docker, or install the compose plugin:
    https://docs.docker.com/compose/install/"
docker info >/dev/null 2>&1 || die \
  "The Docker daemon is not running.
    Start Docker (or Docker Desktop) and run this script again."
ok "docker $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo present)"
ok "docker compose $(docker compose version --short 2>/dev/null || echo present)"

# --------------------------------------------------------------------------
step "Preparing configuration"
if [ -f .env ]; then
  # Never clobber real credentials the operator has already configured.
  ok ".env already exists — leaving it untouched"
else
  [ -f .env.example ] || die ".env.example is missing; is the project complete?"
  cp .env.example .env
  chmod 600 .env 2>/dev/null || true

  admin_key="$(new_secret)"
  db_password="$(new_secret)"
  set_env_value .env ADMIN_API_KEY "$admin_key"
  set_env_value .env POSTGRES_PASSWORD "$db_password"
  # DATABASE_URL carries its own copy of the password; keep the two in step.
  set_env_value .env DATABASE_URL "postgresql+asyncpg://meduza:${db_password}@db:5432/meduza"
  # Start in offline demo mode so the very first run works with no accounts:
  # no Stripe keys, receipts printed to the log instead of emailed.
  set_env_value .env PAYMENT_PROVIDER fake
  set_env_value .env EMAIL_BACKEND console
  set_env_value .env EMAIL_FROM_NAME "$APP_NAME"

  ok "generated .env with fresh admin and database secrets"
  warn "demo mode: payments are simulated, receipts go to the log"
fi
mkdir -p backups

# --------------------------------------------------------------------------
step "Building and starting the stack"
build_args=(--build)
[ "$REBUILD" -eq 1 ] && build_args+=(--force-recreate)
docker compose up -d "${build_args[@]}" || die "docker compose failed to start the stack"
ok "containers are up"

# --------------------------------------------------------------------------
step "Waiting for the service to become healthy"
deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
healthy=0
while [ "$(date +%s)" -lt "$deadline" ]; do
  if curl -fsS "$APP_URL/healthz" >/dev/null 2>&1; then healthy=1; break; fi
  sleep 2
done
if [ "$healthy" -ne 1 ]; then
  printf '\n%s--- recent logs ---%s\n' "$DIM" "$OFF"
  docker compose logs --tail 40 web migrate 2>&1 || true
  die "the service did not become healthy within ${HEALTH_TIMEOUT}s (logs above)"
fi
ok "health check passed"
if curl -fsS "$APP_URL/readyz" >/dev/null 2>&1; then
  ok "readiness check passed (database reachable, provider configured)"
else
  warn "readiness check is failing — see: docker compose logs web"
fi

# --------------------------------------------------------------------------
if [ "$SEED" -eq 1 ]; then
  step "Loading the sample catalog"
  if docker compose exec -T web python -m app.seed >/dev/null 2>&1; then
    ok "catalog ready (re-running this installer will not duplicate it)"
  else
    warn "seeding failed; the app is still running. Retry: docker compose exec web python -m app.seed"
  fi
fi

# --------------------------------------------------------------------------
admin_key_value="$(grep -E '^ADMIN_API_KEY=' .env | cut -d= -f2- || true)"
cat <<EOF

${GREEN}${BOLD}${APP_NAME} is running.${OFF}

  Storefront API   ${APP_URL}
  API docs         ${APP_URL}/docs
  Health           ${APP_URL}/healthz
  Metrics          ${APP_URL}/metrics

  Admin API key    ${admin_key_value}
  ${DIM}(also in .env — treat it like a password)${OFF}

  Try it:
    curl ${APP_URL}/api/catalog/products
    curl -H "X-Admin-Api-Key: \$ADMIN_API_KEY" ${APP_URL}/admin/orders

  Manage:
    docker compose logs -f web worker     follow the logs
    docker compose ps                     service status
    docker compose stop                   stop (data is kept)
    ./installer/uninstall.sh              remove containers

${YELLOW}Before taking real payments${OFF}, edit .env: set PAYMENT_PROVIDER=stripe with
your Stripe keys, EMAIL_BACKEND=smtp with your mail credentials, then re-run
this installer. See README.md for the full production checklist.

EOF
