#!/usr/bin/env bash
# All checks that must pass before a release is pushed.
#
# Run it in the checkout or in an export of the release commit:
#   git archive HEAD | tar -x -C tmp/rel && ln -s ../../node_modules tmp/rel/node_modules
#   (cd tmp/rel && bash scripts/release-checks.sh)
#
# It runs every step, also after a failure, and ends with a summary. The exit
# code is 0 only when all steps pass.
#
# RELEASE_CLIPPY_TOOLCHAINS: space-separated toolchains for clippy. CI uses
#   the newest stable, which can be newer than the local default; name it here
#   (for example "1.99.1 1.100.0"). Default: the active toolchain.
# RELEASE_SKIP_E2E=1: leave out the e2e suite (it needs port 1421).
set -u

root="$(pwd)"
log="$(mktemp -t release-checks.XXXXXX)"
passed=0
failed=()

run() {
  echo "=== $*"
  if "$@" >"$log" 2>&1; then
    echo PASS
    passed=$((passed + 1))
  else
    echo FAIL
    tail -40 "$log"
    failed+=("$*")
  fi
}

run bun run typecheck
run bun run lint
run bun run check:branding
run bunx prettier --check CHANGELOG.md src-server/CHANGELOG.md
# Fewer workers: the full run times out under load with the default (#148).
run bunx vitest run --maxWorkers=4
run node --test scripts/*.test.mjs

for crate in jean-core src-tauri src-server; do
  run cargo fmt --check --manifest-path "$crate/Cargo.toml"
  run cargo metadata --locked --format-version 1 --no-deps \
    --manifest-path "$crate/Cargo.toml"
done

# An export has no target folders: share the checkout's, when it is the parent.
if [ -z "${CARGO_TARGET_DIR:-}" ] && [ ! -d src-tauri/target ] &&
  [ -d "$root/../../src-tauri/target" ]; then
  shared="$(cd "$root/../.." && pwd)"
else
  shared=""
fi
target() { # <crate>
  if [ -n "$shared" ]; then
    case "$1" in
      src-server) echo "$shared/src-server/target" ;;
      *) echo "$shared/src-tauri/target" ;;
    esac
  else
    echo "${CARGO_TARGET_DIR:-}"
  fi
}
cargo_in() { # <crate> <cargo args…>
  local crate="$1" dir
  shift
  dir="$(target "$crate")"
  if [ -n "$dir" ]; then
    CARGO_TARGET_DIR="$dir" cargo "$@"
  else
    cargo "$@"
  fi
}

for toolchain in ${RELEASE_CLIPPY_TOOLCHAINS:-default}; do
  plus=()
  [ "$toolchain" != default ] && plus=("+$toolchain")
  for crate in jean-core src-tauri src-server; do
    run cargo_in "$crate" ${plus[@]+"${plus[@]}"} clippy \
      --manifest-path "$crate/Cargo.toml" -- -D warnings
  done
done

run cargo_in jean-core test --lib --manifest-path jean-core/Cargo.toml
run cargo_in src-tauri test --lib --manifest-path src-tauri/Cargo.toml

# The whole e2e suite, not only the release guards of the CI preflight: a
# stale spec went unnoticed for three releases while only those ran.
if [ "${RELEASE_SKIP_E2E:-}" = 1 ]; then
  echo "=== e2e suite: SKIPPED (RELEASE_SKIP_E2E=1)"
else
  run bunx playwright test --config e2e/playwright.config.ts --reporter=line
fi

rm -f "$log"
echo
echo "passed: $passed, failed: ${#failed[@]}"
for step in ${failed[@]+"${failed[@]}"}; do echo "  FAIL: $step"; done
[ ${#failed[@]} -eq 0 ]
