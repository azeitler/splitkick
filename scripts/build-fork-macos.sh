#!/usr/bin/env bash
# Builds the Splitkick macOS bundle like .github/workflows/preflight.yml does.
#
# Without Apple credentials the overlay's ad-hoc identity ("-") is used, so the
# build works on any machine. Export APPLE_SIGNING_IDENTITY (and the
# notarization variables) to produce a signed build locally.
set -euo pipefail
cd "$(dirname "$0")/.."

exec bun run tauri build --ci \
  --target aarch64-apple-darwin \
  --bundles app,dmg \
  -c src-tauri/tauri.fork.conf.json \
  "$@"
