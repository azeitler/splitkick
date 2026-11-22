#!/usr/bin/env bash
# Run Splitkick's Windows preflight checks in the local Parallels VM, before a
# release. See docs/developer/windows-vm-testing.md.
#
#   scripts/windows-vm-test.sh [options] [ref]     (ref defaults to HEAD)
#     --no-build      skip the installer build, the install and the start
#     --release       build with CI's release profile (fat LTO, much slower)
#
# Tests the committed ref, not the working tree. A ref that is on GitHub is
# fetched from there; anything else goes in as a git bundle through a
# read-only shared folder. The VM never writes into this checkout.
# Exit code 0 = every step passed.
set -uo pipefail

VM="${WINDOWS_VM:-Windows 11}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
XFER="$ROOT/tmp/windows-vm"   # gitignored; shared read-only as \\Mac\splitkick-xfer
SHARE='splitkick-xfer'
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG="$XFER/logs/run-$STAMP.log"

BUILD=1 CARGO_PROFILE=release-fast REF=HEAD
while [ $# -gt 0 ]; do
  case "$1" in
    --no-build) BUILD=0 ;;
    --release) CARGO_PROFILE=release ;;
    -h | --help) sed -n '2,12p' "$0"; exit 0 ;;
    -*) echo "unknown option $1" >&2; exit 2 ;;
    *) REF="$1" ;;
  esac
  shift
done

mkdir -p "$XFER/logs"
exec > >(tee -a "$LOG") 2>&1
started=$(date +%s)
say() { printf '\n## %s\n' "$*"; }

# Runs a PowerShell snippet in the VM. -EncodedCommand (UTF-16LE base64)
# because prlctl exec drops backslashes and double quotes in arguments.
vm_ps() {
  local user=() code
  if [ "$1" = --user ]; then user=(--current-user); shift; fi
  code=$(printf '%s' "$1" | iconv -t UTF-16LE | base64 | tr -d '\n')
  prlctl exec "$VM" ${user[@]+"${user[@]}"} powershell -NoProfile -NonInteractive -OutputFormat Text -ExecutionPolicy Bypass -EncodedCommand "$code"
}

# --- Mac resources: the VM takes 16 GB while it runs.
say "Mac memory"
sysctl -n vm.swapusage
free_pct=$(memory_pressure 2>/dev/null | awk -F': ' '/free percentage/ {print $2+0}')
echo "memory free: ${free_pct:-?}%"
if [ -n "$free_pct" ] && [ "$free_pct" -lt 10 ]; then
  echo "FAIL: less than 10% memory free on the Mac - close something first"
  exit 1
fi

# --- VM up and answering.
say "VM \"$VM\""
state=$(prlctl status "$VM" 2>/dev/null | awk '{print $NF}')
case "$state" in
  running) ;;
  suspended | paused) prlctl resume "$VM" ;;
  stopped) prlctl start "$VM" ;;
  *) echo "FAIL: VM \"$VM\" not found or in state '$state'"; exit 1 ;;
esac
# prlctl exec hangs without an error while Windows installs updates or boots,
# so every probe has a time limit (perl's alarm: macOS has no timeout(1)).
answers() { perl -e 'alarm shift; exec @ARGV' 30 prlctl exec "$VM" "$@" cmd /c ver > /dev/null 2>&1; }
up=0
for i in $(seq 1 60); do
  answers && { up=1; break; }
  [ "$i" = 1 ] && echo "waiting for the VM to answer (up to 30 min; a Windows update can take that long)"
  sleep 30
done
[ "$up" = 1 ] || { echo "FAIL: VM does not answer prlctl exec - look at it: prlctl capture \"$VM\" --file x.png"; exit 1; }
echo "state was: $state"

# --- Transfer share (read-only), set up once.
if ! prlctl list -i "$VM" | grep -q "$SHARE (+)"; then
  prlctl set "$VM" --shf-host on > /dev/null
  prlctl set "$VM" --shf-host-add "$SHARE" --path "$XFER" --mode ro --enable > /dev/null ||
    prlctl set "$VM" --shf-host-set "$SHARE" --path "$XFER" --mode ro --enable > /dev/null
  sleep 5
fi
cp "$ROOT/scripts/windows-vm/vm-test.ps1" "$XFER/vm-test.ps1"

# --- The commit to test.
say "Commit"
SHA=$(git -C "$ROOT" rev-parse --verify "$REF^{commit}") || { echo "FAIL: unknown ref $REF"; exit 1; }
git -C "$ROOT" log -1 --format='%h %s' "$SHA"
BUNDLE_ARG=''
rm -f "$XFER/splitkick.bundle"
git -C "$ROOT" fetch -q origin main || echo "warning: git fetch origin failed; using the local origin/main"
if [ -n "$(git -C "$ROOT" branch -r --contains "$SHA" 2>/dev/null)" ]; then
  echo "on GitHub: fetched in the VM from there"
else
  # A bundle needs a ref name, so a bare SHA that is not on GitHub is refused.
  if [ "$(git -C "$ROOT" rev-parse "$REF")" = "$REF" ]; then
    echo "FAIL: $REF is not on GitHub - pass a branch name or HEAD so it can be bundled"
    exit 1
  fi
  git -C "$ROOT" bundle create -q "$XFER/splitkick.bundle" "origin/main..$REF" || { echo "FAIL: git bundle"; exit 1; }
  echo "not on GitHub: bundle of $(git -C "$ROOT" rev-list --count "origin/main..$SHA") commit(s) on top of origin/main"
  BUNDLE_ARG="-Bundle '\\\\Mac\\$SHARE\\splitkick.bundle'"
fi

# --- Checks and build, as SYSTEM (no signed-in user needed).
say "Checks in the VM (as SYSTEM)"
opts="-Sha $SHA -CargoProfile $CARGO_PROFILE $BUNDLE_ARG"
[ "$BUILD" = 0 ] && opts="$opts -NoBuild"
results=$(mktemp)
vm_ps "\$ProgressPreference = 'SilentlyContinue'
New-Item -ItemType Directory -Force C:\\src\\vm-test | Out-Null
Copy-Item '\\\\Mac\\$SHARE\\vm-test.ps1' C:\\src\\vm-test\\vm-test.ps1 -Force
& C:\\src\\vm-test\\vm-test.ps1 -Part checks $opts" | tr -d '\r' | tee "$results.raw"
grep '^RESULT ' "$results.raw" > "$results"

# --- Install, start, screenshot: needs a signed-in user (desktop session).
if [ "$BUILD" = 1 ] && grep -q '^RESULT PASS tauri build' "$results"; then
  say "Install and start (as the signed-in user)"
  if answers --current-user; then
    vm_ps --user "& C:\\src\\vm-test\\vm-test.ps1 -Part app -CargoProfile $CARGO_PROFILE" | tr -d '\r' | tee "$results.app"
    grep '^RESULT ' "$results.app" >> "$results"
    if grep -q '^RESULT PASS install' "$results.app"; then
      # A frame right after the start can be all black (a few KB): retry.
      for _ in 1 2 3; do
        shot="$ROOT/tmp/windows-vm-app-$(date +%Y%m%d-%H%M%S).png"
        prlctl capture "$VM" --file "$shot" > /dev/null
        [ "$(wc -c < "$shot")" -gt 100000 ] && break
        rm -f "$shot"
        sleep 5
      done
      [ -f "$shot" ] && echo "screenshot: $shot" || echo "screenshot: only black frames"
      vm_ps --user "& C:\\src\\vm-test\\vm-test.ps1 -Part stop" > /dev/null 2>&1
    fi
  else
    echo "nobody is signed in to the VM - sign in once, then run again for this step"
    echo "RESULT SKIP install-and-start(no-signed-in-user) 0" >> "$results"
  fi
fi

# --- Summary.
say "Summary for $(git -C "$ROOT" rev-parse --short "$SHA")"
if [ ! -s "$results" ]; then
  echo "FAIL: the VM run returned no results (see $LOG)"
  exit 1
fi
awk '{ s=$NF; name=$3; for (i=4; i<NF; i++) name=name" "$i; printf "%-5s %-24s %3dm%02ds\n", $2, name, s/60, s%60 }' "$results"
total=$(($(date +%s) - started))
printf 'total %dm%02ds - log %s\n' $((total / 60)) $((total % 60)) "$LOG"
failed=$(grep -c '^RESULT FAIL' "$results")
rm -f "$results" "$results.raw" "$results.app"
if [ "$failed" -gt 0 ]; then
  echo "RESULT: FAIL ($failed step(s))"
  exit 1
fi
echo "RESULT: PASS"
