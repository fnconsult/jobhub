#!/usr/bin/env bash
# Starts the seeded test stack of the app's Maestro flows (#705, docs/ops/mobile.md) in the background, and returns once
# it is up: the e2e web server and its fakes on E2E_WEB_PORT, with its throwaway database (DATABASE_URL's server), and the
# helper on MOBILE_STACK_PORT (e2e/mobile-stack.spec.ts). It writes <ready.json> ({ helper, origin }), which run.ts reads;
# touching <ready.json>.done stops it. Run from the repository root, after `npm run build`.
#
#   E2E_WEB_PORT=3705 MOBILE_STACK_PORT=4705 bash apps/mobile/maestro/start-stack.sh /tmp/maestro-stack.json
set -euo pipefail
ready="${1:?usage: start-stack.sh <ready.json>}"
log="${ready%.json}.log"
rm -f "$ready" "$ready.done"
MOBILE_STACK_READY="$ready" E2E_SCREENSHOTS=0 nohup npx playwright test --project=mobile-stack -g "holds the stack open" > "$log" 2>&1 &
for _ in $(seq 1 600); do
  if [ -f "$ready" ]; then cat "$ready"; echo; exit 0; fi
  sleep 1
done
echo "The seeded stack did not start within 10 minutes:" >&2
cat "$log" >&2
exit 1
