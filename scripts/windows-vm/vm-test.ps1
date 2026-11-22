# Runs inside the Windows VM. Started by scripts/windows-vm-test.sh on the Mac;
# see docs/developer/windows-vm-testing.md.
#   -Part checks  as SYSTEM: check out the commit, run the Windows preflight
#                 checks of .github/workflows/preflight.yml, build the installer
#   -Part app     as the signed-in user: install the built installer, start it
#   -Part stop    as the signed-in user: quit the started app
# Every step writes C:\src\vm-test\logs\<step>.log. The last lines of stdout are
# one "RESULT <PASS|FAIL|SKIP> <step> <seconds>" line per step.
param(
  [Parameter(Mandatory)][ValidateSet('checks', 'app', 'stop')][string]$Part,
  [string]$Sha = '',
  # A git bundle in the transfer share, for commits that are not on GitHub.
  [string]$Bundle = '',
  [string]$CargoProfile = 'release-fast',
  [switch]$NoBuild
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Repo = 'C:\src\splitkick'
$Work = 'C:\src\vm-test'
$Logs = "$Work\logs"
$Target = 'x86_64-pc-windows-msvc'
$Remote = 'https://github.com/azeitler/splitkick.git'
New-Item -ItemType Directory -Force $Logs | Out-Null

# prlctl exec loads no login profile, and SYSTEM has its own. Use the rustup
# and Bun that setup.ps1 installed for the VM user, and the Build Tools clang
# (ring needs it on ARM64 Windows).
$cargoHome = Get-ChildItem 'C:\Users\*\.cargo' -Directory -ErrorAction SilentlyContinue |
  Where-Object { Test-Path "$($_.FullName)\bin\rustup.exe" } | Select-Object -First 1
if (-not $cargoHome) { throw 'rustup not found - run scripts/windows-vm/run.sh setup' }
$env:CARGO_HOME = $cargoHome.FullName
$env:RUSTUP_HOME = Join-Path (Split-Path $cargoHome.FullName) '.rustup'
$bun = Get-ChildItem 'C:\Users\*\AppData\Local\Microsoft\WinGet\Packages\Oven-sh.Bun_*\bun-windows-*\bun.exe',
  'C:\Users\*\.bun\bin\bun.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $bun) { throw 'bun not found - run scripts/windows-vm/run.sh setup' }
$env:Path = @(
  "$env:CARGO_HOME\bin",
  $bun.DirectoryName,
  [Environment]::GetEnvironmentVariable('Path', 'Machine'),
  'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\Llvm\ARM64\bin'
) -join ';'
$env:CI = 'true'
$env:CARGO_TERM_COLOR = 'never'

$script:Results = @()

# Plain stdout. Write-Host reaches prlctl as CLIXML, and Write-Output inside a
# function would become part of its return value.
function Say([string]$Text) { [Console]::Out.WriteLine($Text) }

function Write-Result([string]$State, [string]$Name, [double]$Seconds) {
  $script:Results += "RESULT $State $Name $([int]$Seconds)"
}

# Runs one step through cmd, so stderr is plain log text and not a PowerShell
# error record. A failed step prints its log tail and the run goes on.
function Invoke-Step([string]$Name, [string]$Command) {
  $log = "$Logs\$Name.log"
  $start = Get-Date
  Say "=== $Name"
  & cmd.exe /d /c "($Command) > `"$log`" 2>&1"
  $code = $LASTEXITCODE
  $seconds = ((Get-Date) - $start).TotalSeconds
  if ($code -eq 0) {
    Write-Result 'PASS' $Name $seconds
    return $true
  }
  Say "--- $Name failed (exit $code). Last lines of $log`:"
  Get-Content $log -Tail 60 | ForEach-Object { Say "    $_" }
  Write-Result 'FAIL' $Name $seconds
  return $false
}

function Skip-Step([string]$Name) { Write-Result 'SKIP' $Name 0 }

function Get-Installer {
  Get-ChildItem "$Repo\src-tauri\target\$Target\$CargoProfile\bundle\nsis\*-setup.exe" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
}

if ($Part -eq 'checks') {
  Get-ChildItem $Logs -Filter *.log | Remove-Item -Force
  Set-Location (New-Item -ItemType Directory -Force $Repo)
  # A .git file is a worktree link copied from the Mac by run.sh sync.
  if (Test-Path .git -PathType Leaf) { Remove-Item .git -Force }

  # The checkout keeps node_modules and the cargo target folders between runs
  # (a cold Rust build takes about an hour on 4 vCPUs) and drops the rest.
  $git = 'git -c safe.directory=* -c core.autocrlf=false'
  $fetch = if ($Bundle) {
    "copy /y `"$Bundle`" `"$Work\splitkick.bundle`" && $git fetch --depth=50 origin main && $git bundle unbundle `"$Work\splitkick.bundle`""
  } else {
    "$git fetch --depth=1 origin $Sha"
  }
  $synced = Invoke-Step 'sync' (@(
      "(if not exist .git $git init -q)",
      "($git remote set-url origin $Remote 2>nul || $git remote add origin $Remote)",
      $fetch,
      "$git checkout -q -f --detach $Sha",
      "$git clean -q -ffdx -e node_modules -e src-tauri/target -e jean-core/target -e src-server/target",
      "$git log -1 --format=%H%n%s"
    ) -join ' && ')
  if (-not $synced) {
    $script:Results
    exit 1
  }

  # CI installs the newest stable Rust on every run; so does this.
  Invoke-Step 'rust toolchain' "rustup update stable --no-self-update && rustup target add $Target && rustc -V && cargo clippy -V && bun -v && node -v" | Out-Null

  $js = Invoke-Step 'bun install' 'bun install --frozen-lockfile'
  # Tauri's build script needs bundle.resources ../dist (see preflight.yml).
  New-Item -ItemType Directory -Force dist | Out-Null
  New-Item -ItemType File -Force dist\.gitkeep | Out-Null

  $jsSteps = [ordered]@{
    'typecheck'            = 'bun run typecheck'
    'lint'                 = 'bun run lint'
    # --retry 2: the VM shares 4 vCPUs with Defender and the search indexer, and
    # a busy minute times out UI tests that pass on CI (#148). A real Windows
    # failure fails all three tries.
    'frontend tests'       = 'bun run test:run --retry 2'
    'release script tests' = 'bun run test:splitkick-version && bun run test:changelog-notes && bun run test:release-cut && bun run test:updater-manifest'
    'web tests'            = 'bun run test:web-branding && bun run test:web-service-worker'
    'branding check'       = 'bun run check:branding'
  }
  foreach ($step in $jsSteps.GetEnumerator()) {
    if ($js) { Invoke-Step $step.Key $step.Value | Out-Null } else { Skip-Step $step.Key }
  }

  Invoke-Step 'rust fmt' 'bun run rust:fmt:check' | Out-Null
  Invoke-Step 'rust clippy' 'bun run rust:clippy' | Out-Null
  Invoke-Step 'rust tests' 'bun run rust:test' | Out-Null

  # The installer CI uploads, without the updater key (the keyless branch of
  # the CI step), for the x64 target. -CargoProfile release gives CI's exact
  # profile; release-fast is the default because fat LTO takes much longer.
  if ($NoBuild -or -not $js) {
    Skip-Step 'tauri build'
  } else {
    # tauri-build copies bundle.resources (../dist) into the target folder with
    # CopyFile, which cannot overwrite a hidden file ("Access is denied"). An
    # old run.sh sync (robocopy from the Mac share) left hidden dotfiles there.
    # The copies are rebuilt on every build, so drop them first.
    Get-ChildItem "src-tauri\target" -Directory -Filter dist -Depth 2 -ErrorAction SilentlyContinue |
      Remove-Item -Recurse -Force
    # As SYSTEM, Tauri caches NSIS under C:\Windows\System32\config\systemprofile,
    # and the 32-bit makensis.exe is redirected away from System32 ("Unable to
    # start child process, error 0x2"). useLocalToolsDir caches the tools in
    # src-tauri\target instead. https://schema.tauri.app/config/2
    $vmConfig = "$Work\vm-tauri.conf.json"
    Set-Content -Path $vmConfig -Value '{"bundle":{"useLocalToolsDir":true}}' -Encoding ascii
    $profileArg = if ($CargoProfile -eq 'release') { '' } else { " -- --profile $CargoProfile" }
    $built = Invoke-Step 'tauri build' "bun run tauri build --ci --target $Target --bundles nsis -c src-tauri/tauri.fork.conf.json -c `"$vmConfig`"$profileArg"
    if ($built -and -not (Get-Installer)) {
      Say '--- tauri build reported success but produced no *-setup.exe'
      $script:Results[-1] = $script:Results[-1] -replace '^RESULT PASS', 'RESULT FAIL'
    }
  }
}

if ($Part -eq 'app') {
  # As the signed-in user: install per user, start, check it stays up.
  $start = Get-Date
  try {
    $setup = Get-Installer
    if (-not $setup) { throw 'no installer - the build step did not produce one' }
    Get-Process Splitkick -ErrorAction SilentlyContinue | Stop-Process -Force
    Say "=== install $($setup.Name) /S /CURRENTUSER"
    # The installer (installMode "both") asks an admin user for elevation even
    # with /CURRENTUSER, and nobody can click a UAC prompt from here.
    # RunAsInvoker starts it without elevation; a per-user install needs none.
    $env:__COMPAT_LAYER = 'RunAsInvoker'
    $p = Start-Process -FilePath $setup.FullName -ArgumentList '/S', '/CURRENTUSER' -Wait -PassThru
    Remove-Item Env:__COMPAT_LAYER
    $exe = "$env:LOCALAPPDATA\Splitkick\Splitkick.exe"
    if ($p.ExitCode -ne 0) { throw "installer exit code $($p.ExitCode)" }
    if (-not (Test-Path $exe)) { throw "not installed: $exe" }
    Say "installed: $exe ($((Get-Item $exe).LastWriteTime))"
    $logFile = "$env:LOCALAPPDATA\app.splitkick.desktop\logs\Splitkick.log"
    $skip = if (Test-Path $logFile) { @(Get-Content $logFile).Count } else { 0 }
    $proc = Start-Process -FilePath $exe -PassThru
    Start-Sleep -Seconds 30
    $proc.Refresh()
    if ($proc.HasExited) { throw "Splitkick exited during start-up (code $($proc.ExitCode))" }
    Say "Splitkick is running (pid $($proc.Id))"
    if (Test-Path $logFile) {
      $errors = @(Get-Content $logFile | Select-Object -Skip $skip | Select-String -Pattern '\[ERROR\]')
      Say "[ERROR] lines the app logged since the start: $($errors.Count)"
      $errors | Select-Object -First 10 | ForEach-Object { Say "    $($_.Line)" }
    }
    Write-Result 'PASS' 'install and start' ((Get-Date) - $start).TotalSeconds
  } catch {
    Say "--- install and start failed: $($_.Exception.Message)"
    Write-Result 'FAIL' 'install and start' ((Get-Date) - $start).TotalSeconds
  }
}

if ($Part -eq 'stop') {
  Get-Process Splitkick -ErrorAction SilentlyContinue | Stop-Process -Force
  exit 0
}

$script:Results
if ($script:Results -match '^RESULT FAIL') { exit 1 }
exit 0
