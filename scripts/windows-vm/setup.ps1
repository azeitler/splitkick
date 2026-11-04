# One-time dev tool setup for the Windows 11 VM (issue #71).
# Run from the Mac with scripts/windows-vm/run.sh setup, which calls this twice:
#   -Part machine  as SYSTEM (no UAC prompt): MSVC Build Tools, Git, Node.js, Defender exclusion
#   -Part user     as the logged-in user:     rustup (+ x64 target), Bun
# Safe to re-run: winget skips packages that are already installed.
param([Parameter(Mandatory)][ValidateSet('machine', 'user')][string]$Part)

$ErrorActionPreference = 'Stop'

function Find-Winget {
  $cmd = Get-Command winget.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  # SYSTEM has no WindowsApps alias on PATH; call the App Installer package
  # directly. It needs its VCLibs/UI.Xaml frameworks on PATH, or it exits with
  # 0xC0000135 (DLL not found).
  $frameworks = Get-ChildItem 'C:\Program Files\WindowsApps' -Directory | Where-Object {
    $_.Name -like 'Microsoft.VCLibs.140.00*_arm64__8wekyb3d8bbwe' -or $_.Name -like 'Microsoft.UI.Xaml*_arm64__8wekyb3d8bbwe'
  }
  $env:Path = (($frameworks | ForEach-Object FullName) -join ';') + ';' + $env:Path
  $dir = Get-ChildItem 'C:\Program Files\WindowsApps' -Filter 'Microsoft.DesktopAppInstaller_*_arm64__8wekyb3d8bbwe' -Directory |
    Sort-Object Name -Descending | Select-Object -First 1
  if (-not $dir) { throw 'winget (App Installer) not found' }
  return Join-Path $dir.FullName 'winget.exe'
}

function Install-Package([string]$Id, [string[]]$Extra = @()) {
  Write-Host "== $Id"
  & $script:Winget install --id $Id --exact --silent --disable-interactivity `
    --accept-package-agreements --accept-source-agreements @Extra
  # 0 = installed, -1978335189 = already installed / no newer version.
  if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne -1978335189) {
    throw "winget install $Id failed with $LASTEXITCODE"
  }
}

$script:Winget = Find-Winget

if ($Part -eq 'machine') {
  # MSVC for both host (ARM64) and the x64 release target. ring needs clang for
  # ARM64 Windows: https://github.com/briansmith/ring/blob/main/BUILDING.md
  $vs = '--quiet --wait --norestart --nocache' +
    ' --add Microsoft.VisualStudio.Workload.VCTools' +
    ' --add Microsoft.VisualStudio.Component.VC.Tools.ARM64' +
    ' --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64' +
    ' --add Microsoft.VisualStudio.Component.VC.Llvm.Clang' +
    ' --includeRecommended'
  Install-Package 'Microsoft.VisualStudio.2022.BuildTools' @('--scope', 'machine', '--override', $vs)
  Install-Package 'Git.Git' @('--scope', 'machine')
  Install-Package 'OpenJS.NodeJS.LTS' @('--scope', 'machine')
  # Defender scanning every object file makes cargo builds several times slower.
  Add-MpPreference -ExclusionPath 'C:\src', "$env:SystemDrive\Users\*\.cargo", "$env:SystemDrive\Users\*\.rustup"
} else {
  Install-Package 'Rustlang.Rustup'
  Install-Package 'Oven-sh.Bun'
  $env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
  rustup default stable-msvc
  rustup target add x86_64-pc-windows-msvc
}
Write-Host "setup ($Part) done"
