#!/usr/bin/env bash
# Drive the Parallels Windows 11 VM from the Mac (issue #71).
#   run.sh share               share this checkout read-only as \\Mac\splitkick (once)
#   run.sh setup               install the dev tools (once; see setup.ps1)
#   run.sh sync                mirror the checkout to C:\src\splitkick (keeps the VM's node_modules/target)
#   run.sh gate                sync + the preflight checks
#   run.sh build [x64|arm64]   sync + NSIS build with the Splitkick overlay (default x64)
#   run.sh smoke [x64|arm64]   start the built app, check it stays up and logs
#   run.sh shot [name]         screenshot of the VM screen to tmp/<name>-<stamp>.png
#   run.sh stop                quit Splitkick in the VM
# The exit code is the VM's, so a session can tell pass from fail.
set -euo pipefail

VM="${WINDOWS_VM:-Windows 11}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# prlctl drops one backslash of a leading \\ - single quotes keep them intact.
as_user() { prlctl exec "$VM" --current-user powershell -NoProfile -ExecutionPolicy Bypass "$@"; }
as_system() { prlctl exec "$VM" powershell -NoProfile -ExecutionPolicy Bypass "$@"; }

sync() {
  # robocopy exit codes below 8 mean success.
  as_user -Command 'New-Item -ItemType Directory -Force C:\src | Out-Null;
    robocopy \\Mac\splitkick C:\src\splitkick /MIR /XD node_modules target tmp dist .git /NFL /NDL /NJH /NP | Out-Null;
    if ($LASTEXITCODE -ge 8) { exit $LASTEXITCODE } else { exit 0 }'
}

vm() { as_user -File 'C:\src\splitkick\scripts\windows-vm\vm.ps1' "$@"; }

case "${1:-}" in
  share)
    prlctl set "$VM" --shf-host on
    prlctl set "$VM" --shf-host-add splitkick --path "$ROOT" --mode ro --enable ;;
  setup)
    as_user -Command 'New-Item -ItemType Directory -Force C:\src | Out-Null; Copy-Item \\Mac\splitkick\scripts\windows-vm\setup.ps1 C:\src\setup.ps1 -Force'
    as_system -File 'C:\src\setup.ps1' -Part machine
    as_user -File 'C:\src\setup.ps1' -Part user ;;
  sync) sync ;;
  gate) sync && vm -Step gate ;;
  build) sync && vm -Step build -Arch "${2:-x64}" ;;
  smoke) vm -Step smoke -Arch "${2:-x64}" ;;
  shot)
    mkdir -p "$ROOT/tmp"
    file="$ROOT/tmp/${2:-vm}-$(date +%Y%m%d-%H%M%S).png"
    prlctl capture "$VM" --file "$file" > /dev/null
    echo "$file" ;;
  stop) as_user -Command 'Get-Process Splitkick -ErrorAction SilentlyContinue | Stop-Process -Force' ;;
  *) sed -n '2,10p' "$0"; exit 2 ;;
esac
