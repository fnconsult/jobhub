#!/usr/bin/env bash
# Installs Maestro's CLI at MAESTRO_VERSION into ~/.maestro (bin, lib) for the mobile-e2e workflow, from its GitHub
# release, the archive checked before it is used: its SHA-256 is MAESTRO_SHA256, and it unzips whole. The download is
# tried again, a bounded number of times: it answered 504, then a cut archive that the installer of
# get.maestro.mobile.dev unpacked as it was. The workflow keeps ~/.maestro/bin and ~/.maestro/lib in its cache, per
# version and checksum: a run that restores them downloads nothing.
#
#   MAESTRO_VERSION=2.11.0 MAESTRO_SHA256=<sha-256 of maestro.zip> bash apps/mobile/maestro/ci/install-maestro.sh
#
# A new version: its checksum is `shasum -a 256 maestro.zip`, of
# https://github.com/mobile-dev-inc/Maestro/releases/download/cli-<version>/maestro.zip.
set -euo pipefail
version="${MAESTRO_VERSION:?MAESTRO_VERSION is not set}"
sha256="${MAESTRO_SHA256:?MAESTRO_SHA256 is not set}"
home="${MAESTRO_DIR:-$HOME/.maestro}"
url="${MAESTRO_ARCHIVE_URL:-https://github.com/mobile-dev-inc/Maestro/releases/download/cli-$version/maestro.zip}"
tries="${MAESTRO_DOWNLOAD_TRIES:-5}"
wait="${MAESTRO_DOWNLOAD_WAIT:-15}"

installed() { [ -x "$home/bin/maestro" ] && [ -f "$home/lib/maestro-cli-$version.jar" ]; }
if installed; then
  echo "Maestro $version is already in $home (restored from the cache): nothing to download"
  exit 0
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
archive="$work/maestro.zip"
try=1
while true; do
  rm -f "$archive"
  failure=""
  if ! curl --fail --silent --show-error --location --connect-timeout 30 --max-time 900 --output "$archive" "$url"; then
    failure="the download failed"
  elif [ "$(shasum -a 256 "$archive" | cut -d ' ' -f 1)" != "$sha256" ]; then
    failure="the archive's SHA-256 is not MAESTRO_SHA256 (cut short, or not the release's)"
  elif ! unzip -tq "$archive" > /dev/null; then
    failure="the archive does not unzip"
  fi
  [ -z "$failure" ] && break
  if [ "$try" -ge "$tries" ]; then
    echo "::error::Maestro $version could not be installed after $try tries: $failure"
    exit 1
  fi
  echo "::warning::Maestro $version, try $try of $tries: $failure; again in $wait s"
  sleep "$wait"
  try=$((try + 1))
  wait=$((wait * 2))
done

unzip -q "$archive" -d "$work"
mkdir -p "$home"
rm -rf "$home/bin" "$home/lib"
mv "$work/maestro/bin" "$work/maestro/lib" "$home/"
installed || { echo "::error::Maestro's archive has no bin/maestro and lib/maestro-cli-$version.jar"; exit 1; }
echo "Maestro $version installed in $home"
