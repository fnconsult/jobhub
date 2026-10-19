#!/usr/bin/env bash
# Deploys one Jobbbox environment on the VPS. Run by .github/workflows/deploy.yml over SSH.
#
# Required:
#   JOBHUB_TARGET    staging | production (named, never guessed)
#   JOBHUB_ROOT      e.g. /opt/jobbbox/staging; holds .env and the checkout in ./app
#   JOBHUB_HOST      e.g. staging.jobbbox.ai
#   JOBHUB_SLUG      compose project and Traefik router name, e.g. jobbbox-staging
#   JOBHUB_REVISION  the commit SHA checked out in $JOBHUB_ROOT/app (the workflow checks it out
#                    before running this script, so the script that runs is the revision's own)
#                    and the tag of the images to run
#   JOBHUB_IMAGES    image prefix, e.g. ghcr.io/fnconsult/jobhub (…/web, …/migrate, …/worker)
#   GHCR_TOKEN       the workflow's short-lived token, to pull the images; never stored
set -euo pipefail

for v in JOBHUB_TARGET JOBHUB_ROOT JOBHUB_HOST JOBHUB_SLUG JOBHUB_REVISION JOBHUB_IMAGES GHCR_TOKEN; do
  if [ -z "${!v:-}" ]; then echo "✗ $v is required" >&2; exit 1; fi
done
case "$JOBHUB_TARGET" in
  staging | production) ;;
  *) echo "✗ JOBHUB_TARGET must be staging or production, got '$JOBHUB_TARGET'" >&2; exit 1 ;;
esac
case "$JOBHUB_ROOT" in
  *"$JOBHUB_TARGET"*) ;;
  *) echo "✗ JOBHUB_ROOT ($JOBHUB_ROOT) does not name the target ($JOBHUB_TARGET): refusing, it could be the other environment" >&2; exit 1 ;;
esac

APP="$JOBHUB_ROOT/app"
ENV_FILE="$JOBHUB_ROOT/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "✗ $ENV_FILE is missing. Create it from .env.example (see docs/ops/hosting.md)." >&2
  exit 1
fi
for key in POSTGRES_PASSWORD AUTH_SECRET SECRETS_MASTER_KEYS; do
  if ! grep -qE "^${key}=.+" "$ENV_FILE"; then
    echo "✗ $key is not set in $ENV_FILE" >&2
    exit 1
  fi
done

# One deployment at a time per environment.
exec 9>"$JOBHUB_ROOT/.deploy.lock"
if ! flock -n 9; then echo "✗ another deployment of $JOBHUB_TARGET is running" >&2; exit 1; fi

if docker info >/dev/null 2>&1; then
  DOCKER=(docker)
elif sudo -n docker info >/dev/null 2>&1; then
  DOCKER=(sudo -n --preserve-env=JOBHUB_ENV_FILE,JOBHUB_HOST,JOBHUB_SLUG,JOBHUB_REVISION,JOBHUB_IMAGES,DOCKER_CONFIG docker)
else
  echo "✗ $(id -un) cannot run docker (not in the docker group, no passwordless sudo)" >&2
  exit 1
fi

echo "▸ $JOBHUB_TARGET: $JOBHUB_HOST ← $JOBHUB_REVISION"
head=$(git -C "$APP" rev-parse HEAD)
if [ "$head" != "$JOBHUB_REVISION" ]; then
  echo "✗ $APP is at $head, not $JOBHUB_REVISION" >&2
  exit 1
fi

export JOBHUB_ENV_FILE="$ENV_FILE" JOBHUB_HOST JOBHUB_SLUG JOBHUB_REVISION JOBHUB_IMAGES
compose=("${DOCKER[@]}" compose -f "$APP/deploy/compose.yml" -p "$JOBHUB_SLUG" --env-file "$ENV_FILE")

# Log in to GHCR in a throwaway Docker config, so the token is never kept on the VPS.
DOCKER_CONFIG=$(mktemp -d)
export DOCKER_CONFIG
trap 'rm -rf "$DOCKER_CONFIG"' EXIT
printf '%s' "$GHCR_TOKEN" | "${DOCKER[@]}" login ghcr.io -u github-actions --password-stdin >/dev/null
"${compose[@]}" pull --quiet
"${DOCKER[@]}" logout ghcr.io >/dev/null

"${compose[@]}" up -d --remove-orphans

# `up` waits for migrate to finish before starting web and worker; check how it ended.
cid=$("${compose[@]}" ps -aq migrate | head -1)
code=$("${DOCKER[@]}" inspect -f '{{.State.ExitCode}}' "$cid")
if [ "$code" != "0" ]; then
  "${compose[@]}" logs --tail=80 migrate
  echo "✗ migrations failed (exit $code)" >&2
  exit 1
fi

echo "▸ waiting for the web container to be healthy"
web=$("${compose[@]}" ps -q web | head -1)
for _ in $(seq 1 60); do
  status=$("${DOCKER[@]}" inspect -f '{{.State.Health.Status}}' "$web")
  [ "$status" = "healthy" ] && break
  sleep 3
done
if [ "$status" != "healthy" ]; then
  "${compose[@]}" logs --tail=80 web
  echo "✗ web is $status" >&2
  exit 1
fi

"${DOCKER[@]}" image prune -f >/dev/null
"${compose[@]}" ps
echo "✓ $JOBHUB_TARGET deployed: https://$JOBHUB_HOST ($JOBHUB_REVISION)"
