# Runs inside the Windows VM, in the synced copy C:\src\splitkick (issue #71).
# Started by scripts/windows-vm/run.sh; see docs/developer/windows-support-evaluation.md.
param(
  [Parameter(Mandatory)][ValidateSet('gate', 'test', 'build', 'smoke')][string]$Step,
  [ValidateSet('x64', 'arm64')][string]$Arch = 'x64',
  # For -Step test: space-separated cargo test name filters for jean-core.
  [string]$Filter = ''
)

$ErrorActionPreference = 'Stop'
$Repo = 'C:\src\splitkick'
$Target = @{ x64 = 'x86_64-pc-windows-msvc'; arm64 = 'aarch64-pc-windows-msvc' }[$Arch]

# prlctl exec does not load a login profile: rebuild PATH from the registry and
# add rustup's and Bun's per-user folders. ring needs clang for ARM64 Windows
# (https://github.com/briansmith/ring/blob/main/BUILDING.md); use the one from
# the Build Tools.
$env:Path = @(
  [Environment]::GetEnvironmentVariable('Path', 'Machine'),
  [Environment]::GetEnvironmentVariable('Path', 'User'),
  "$env:USERPROFILE\.cargo\bin",
  "$env:USERPROFILE\.bun\bin",
  'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\Llvm\ARM64\bin'
) -join ';'
Set-Location $Repo

function Invoke-Step([string]$Name, [scriptblock]$Block) {
  Write-Host "`n=== $Name"
  & $Block
  if ($LASTEXITCODE -ne 0) { throw "$Name failed with exit code $LASTEXITCODE" }
}

switch ($Step) {
  'gate' {
    # The checks of .github/workflows/preflight.yml, in the same order.
    Invoke-Step 'bun install' { bun install --frozen-lockfile }
    Invoke-Step 'typecheck' { bun run typecheck }
    Invoke-Step 'lint' { bun run lint }
    New-Item -ItemType Directory -Force dist | Out-Null
    Invoke-Step 'rust:clippy' { bun run rust:clippy }
    Invoke-Step 'test:run' { bun run test:run }
    Invoke-Step 'test:splitkick-version' { bun run test:splitkick-version }
    Invoke-Step 'test:changelog-notes' { bun run test:changelog-notes }
    Invoke-Step 'test:release-cut' { bun run test:release-cut }
    Invoke-Step 'test:updater-manifest' { bun run test:updater-manifest }
    Invoke-Step 'test:web-branding' { bun run test:web-branding }
    Invoke-Step 'check:branding' { bun run check:branding }
    Invoke-Step 'rust:test' { bun run rust:test }
  }
  'test' {
    Invoke-Step "jean-core tests $Filter" { cargo test --manifest-path jean-core/Cargo.toml -- @($Filter -split ' ' | Where-Object { $_ }) }
  }
  'build' {
    Invoke-Step 'bun install' { bun install --frozen-lockfile }
    # The Splitkick identity comes from the fork overlay. release-fast keeps
    # the build time sane on 4 vCPUs.
    Invoke-Step "tauri build ($Target)" {
      bun run tauri build --ci --target $Target --bundles nsis -c src-tauri/tauri.fork.conf.json -- --profile release-fast
    }
    Get-ChildItem "src-tauri\target\$Target\release-fast\bundle\nsis\*.exe" | Format-Table Name, Length
  }
  'smoke' {
    $exe = "src-tauri\target\$Target\release-fast\Splitkick.exe"
    if (-not (Test-Path $exe)) { throw "no build at $exe - run the build step first" }
    Get-Process Splitkick -ErrorAction SilentlyContinue | Stop-Process -Force
    $logDir = "$env:LOCALAPPDATA\app.splitkick.desktop\logs"
    $started = Get-Date
    $proc = Start-Process -FilePath (Resolve-Path $exe) -PassThru
    Start-Sleep -Seconds 25
    $proc.Refresh()
    if ($proc.HasExited) { throw "Splitkick exited during start-up (code $($proc.ExitCode))" }
    Write-Host "Splitkick is running (pid $($proc.Id), arch $Arch)"
    $log = Get-ChildItem $logDir -Filter *.log -ErrorAction SilentlyContinue |
      Where-Object LastWriteTime -gt $started | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $log) { throw "no log written to $logDir since start-up" }
    Write-Host "log: $($log.FullName)"
    Get-Content $log.FullName -Tail 15
    Select-String -Path $log.FullName -Pattern '\[ERROR\]' | Select-Object -First 10 | ForEach-Object Line
  }
}
Write-Host "`n$Step ok"
