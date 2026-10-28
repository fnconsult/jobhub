#!/usr/bin/env bash
# Draws the screenshot baselines again (#463), in Linux Chromium as CI compares them, on any machine with Docker:
# in the Playwright image of the version the repo pins, against a throwaway Postgres, from a copy of the working tree
# (uncommitted changes included). The new PNGs land in e2e/__screenshots__; review them with `git diff` before
# committing. See docs/agents/screenshot-baselines.md.
#
#   scripts/update-screenshot-baselines.sh                                  # every screenshot spec
#   scripts/update-screenshot-baselines.sh e2e/design-system-page.spec.ts   # one spec
set -euo pipefail
cd "$(dirname "$0")/.."

# The specs that hold a toHaveScreenshot, unless named.
if [ "$#" -gt 0 ]; then
  specs=("$@")
else
  specs=()
  while IFS= read -r spec; do specs+=("$spec"); done < <(grep -l "toHaveScreenshot" e2e/*.spec.ts)
fi

version=$(node -p 'require("@playwright/test/package.json").version')
image="mcr.microsoft.com/playwright:v${version}-noble"
name="jobhub-baselines-$$"

cleanup() {
  docker rm -f "$name-run" "$name-pg" >/dev/null 2>&1 || true
  docker network rm "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker network create "$name" >/dev/null
docker run -d --name "$name-pg" --network "$name" \
  -e POSTGRES_USER=jobhub -e POSTGRES_PASSWORD=jobhub -e POSTGRES_DB=jobhub postgres:17-alpine >/dev/null
until docker exec "$name-pg" pg_isready -U jobhub -d jobhub >/dev/null 2>&1; do sleep 1; done

# The working tree's files as git sees them (tracked, and untracked but not ignored), sent in on stdin: Docker on a Mac
# (Colima, Docker Desktop) may not share the folder the repo sits in.
files() { git ls-files -z --cached --others --exclude-standard | while IFS= read -r -d '' file; do [ -e "$file" ] && printf '%s\0' "$file"; done; }
files | COPYFILE_DISABLE=1 tar --no-xattrs --null -T - -cf - | docker run -i --name "$name-run" --network "$name" --ipc=host \
  -e DATABASE_URL="postgres://jobhub:jobhub@$name-pg:5432/jobhub" -e NEXT_TELEMETRY_DISABLED=1 -e E2E_SCREENSHOTS=1 \
  "$image" bash -euo pipefail -c '
    mkdir -p /work/e2e/__screenshots__
    tar -C /work -xf -
    cd /work
    npm ci --no-audit --no-fund
    npm run build
    npm run db:migrate
    npx playwright test --project=web --update-snapshots=changed "$@"
  ' baselines "${specs[@]}"

mkdir -p e2e/__screenshots__
docker cp "$name-run:/work/e2e/__screenshots__/." e2e/__screenshots__/

echo "Baselines drawn in e2e/__screenshots__. Review them (git diff, or open the PNGs) before committing."
