#!/usr/bin/env bash
# Runs a command of the mobile-e2e workflow that downloads (a package, a browser, a compiler), again when it fails, a
# bounded number of times, waiting longer before each try: a 504 or a timeout of one registry no longer costs the run
# and, on macOS, its hour in the runners' queue. Only for commands safe to run twice. The last failure is the step's.
#
#   bash apps/mobile/maestro/ci/retry.sh <tries> <first wait, in seconds> <command> [arguments…]
set -uo pipefail
tries="${1:?usage: retry.sh <tries> <first wait> <command> [arguments…]}"
wait="${2:?usage: retry.sh <tries> <first wait> <command> [arguments…]}"
shift 2
[ "$#" -gt 0 ] || { echo "usage: retry.sh <tries> <first wait> <command> [arguments…]" >&2; exit 2; }
try=1
while true; do
  "$@" && exit 0
  status=$?
  if [ "$try" -ge "$tries" ]; then
    echo "::error::« $* » failed $try time(s), the last with status $status"
    exit "$status"
  fi
  echo "::warning::« $* » failed (status $status), try $try of $tries: again in $wait s"
  sleep "$wait"
  try=$((try + 1))
  wait=$((wait * 2))
done
