# Windows tests in the local VM

Run the Windows preflight checks on the Mac, before a release, so a
Windows-only failure shows up before the tag and not in CI. (1.5.18 shipped
macOS-only because a Windows-only test failure was seen only in CI.)

```sh
scripts/windows-vm-test.sh            # test HEAD
scripts/windows-vm-test.sh main       # or any branch / pushed commit
scripts/windows-vm-test.sh --no-build # checks only, no installer
scripts/windows-vm-test.sh --release  # CI's exact release profile (slower)
```

The last lines are a table of PASS / FAIL / SKIP per step with its time and
`RESULT: PASS` or `RESULT: FAIL`; the exit code is 0 only when every step
passed. A failed step prints the last 60 lines of its log. The full output is
in `tmp/windows-vm/logs/run-<stamp>.log`; the per-step logs stay in the VM in
`C:\src\vm-test\logs\<step>.log`.

## What it does

`scripts/windows-vm-test.sh` (Mac) and `scripts/windows-vm/vm-test.ps1` (VM):

1. **Mac memory.** Prints swap and free memory; stops below 10 % free. The VM
   takes 16 GB while it runs.
2. **VM.** Starts or resumes the Parallels VM "Windows 11" (override with
   `WINDOWS_VM=<name>`) and waits up to 30 minutes until `prlctl exec`
   answers.
3. **Transfer share.** `tmp/windows-vm/` (gitignored) is shared read-only into
   the VM as `\\Mac\splitkick-xfer`. It carries `vm-test.ps1` and, when
   needed, a git bundle. The VM never sees or writes the Mac checkout.
4. **Commit.** The script tests a committed ref, never the working tree. A
   commit that is on GitHub is fetched in the VM from
   `https://github.com/azeitler/splitkick.git`. Anything else goes in as
   `git bundle create … origin/main..<ref>` (a bare SHA that is not on
   GitHub is refused: pass a branch name or `HEAD`).
5. **Checks, as SYSTEM** (no signed-in user needed), in `C:\src\splitkick` —
   the Windows job of `.github/workflows/preflight.yml`, same order:
   `rustup update stable` (CI uses the newest stable), `bun install
--frozen-lockfile`, typecheck, lint, `test:run --retry 2`, the release script tests,
   the web tests, the branding check, `rust:fmt:check`, `rust:clippy`
   (`-D warnings`), `rust:test`.
6. **Build.** `tauri build --ci --target x86_64-pc-windows-msvc --bundles nsis
-c src-tauri/tauri.fork.conf.json`, without the updater key (CI's keyless
   branch), with the `release-fast` profile unless `--release`, plus
   `bundle.useLocalToolsDir` (see Known limits).
7. **Install and start, as the signed-in user.** Installs the NSIS setup with
   `/S /CURRENTUSER` to `%LOCALAPPDATA%\Splitkick`, starts `Splitkick.exe`,
   checks it is still running after 30 s, prints the `[ERROR]` lines it logged
   since the start, takes a screenshot to
   `tmp/windows-vm-app-<stamp>.png`, then quits the app (the install stays;
   the next run installs over it). If nobody is signed in to the VM, this step
   is SKIP: sign in once in the Parallels window and run again.

The checkout keeps `node_modules` and the three cargo `target` folders between
runs (`git clean -ffdx` with those excluded); all other files come from the
commit.

## How long it takes

Measured 2026-11-22 on an Apple silicon MacBook Pro, VM with 4 vCPUs and
16 GB, Splitkick 1.5.24:

| Step                     | Warm (caches, idle VM) | Cold (new Rust, busy VM) |
| ------------------------ | ---------------------- | ------------------------ |
| sync, toolchain, install | < 10 s                 | 1 min                    |
| typecheck + lint         | 2 min                  | 5 min                    |
| `test:run`               | 4–5 min                | 22 min                   |
| other script tests       | < 10 s                 | < 10 s                   |
| `rust:fmt` + clippy      | 2 min                  | 12 min                   |
| `rust:test`              | 6–10 min               | 43 min                   |
| tauri build (x64)        | 13 min                 | 35 min                   |
| install and start        | 1 min                  | 1 min                    |
| **total**                | **about 30 min**       | **about 2 h**            |

A Rust update (`rustup update stable` finds a new release) makes the run
cold again. A busy VM (Windows update, first sign-in, Defender scan) can
double the warm times.

## Setup once

Done on the current VM; repeat on a new one.

1. Parallels Desktop with a Windows 11 VM named "Windows 11". On Apple silicon
   it is **Windows on ARM64**.
2. In the VM, sign in once as the user who will own the tools.
3. `scripts/windows-vm/run.sh setup` (needs the old `\\Mac\splitkick` share
   from `run.sh share`) installs, through winget: Visual Studio 2022 Build
   Tools (VCTools with the ARM64, x64 and Clang components), Git, Node.js
   LTS, a Defender exclusion for `C:\src` and the cargo/rustup folders (as
   SYSTEM); rustup with the `x86_64-pc-windows-msvc` target and Bun (as the
   user). WebView2 comes with Windows 11.
4. Nothing else: the first `windows-vm-test.sh` run adds the transfer share,
   turns on host sharing, turns `C:\src\splitkick` into a git checkout, and
   updates Rust.

`vm-test.ps1` runs as SYSTEM but uses the user's rustup
(`C:\Users\*\.cargo`, `.rustup`) and Bun (winget package folder), so the
tools are installed once.

## Known limits

- **ARM64, not x64.** The checks and tests run natively on ARM64 Windows. The
  installer is the x64 one (as CI ships), cross-compiled and run under x64
  emulation. It does not prove native x64 behaviour; the `windows-latest`
  CI job stays the x64 gate.
- **`release-fast`, not `release`.** The default build uses thin LTO; CI
  uses fat LTO with one codegen unit. Use `--release` before a release that
  changes build settings.
- **Committed code only.** Commit (no push needed) before you run it.
- **No secrets.** Nothing is signed; no key enters the VM or argv.
- **No mock e2e guards.** `test:e2e:release-guards` runs on macOS only in CI
  too. In the VM, `playwright install chromium` (as SYSTEM, x64 Chromium on
  ARM64) hung after the download for 20 minutes (2026-11-22), so the script
  does not run it.
- **One run at a time.** Two runs share `C:\src\splitkick`.
- **`test:run --retry 2`, CI has no retry.** The VM shares its 4 vCPUs with
  Defender and the search indexer (heavy after a Windows update or a fresh
  sign-in). On a busy run, UI tests time out that pass on an idle run (#148):
  the same commit had 0 and 5 timeouts in two runs. A real Windows failure
  fails all three tries and stays FAIL.
- **A known Windows flake** (#153): `permission_change_survives_concurrent_open_marks`
  in `rust:test` failed once in four runs of the same commit.
- **The installer asks admins for elevation** (#152), also with
  `/S /CURRENTUSER`, and nobody can click a UAC prompt over `prlctl`. The
  script starts the installer with `__COMPAT_LAYER=RunAsInvoker` (no
  elevation); a per-user install needs none.
- **Build tools as SYSTEM.** Tauri caches NSIS in the user's cache folder,
  which for SYSTEM is under `C:\Windows\System32`; the 32-bit `makensis.exe`
  is redirected away from it ("Unable to start child process, error 0x2").
  `-c` with `{"bundle":{"useLocalToolsDir":true}}` keeps the tools in
  `src-tauri\target` ([config schema](https://schema.tauri.app/config/2)).
- **Hidden leftovers.** `run.sh sync` (robocopy from the Mac share) marks
  dotfiles hidden, and `CopyFile` cannot overwrite a hidden file, so
  tauri-build failed with "Access is denied. (os error 5)" on
  `target\…\dist\sounds\.gitkeep`. The script deletes the `dist` copies in
  `target` before each build.
- **Windows Update.** While Windows installs updates, `prlctl exec` hangs
  without an error. The script waits up to 30 minutes; after that, look at
  the VM (`prlctl capture "Windows 11" --file x.png`).
- **`prlctl exec` quoting.** It drops backslashes and double quotes from
  arguments, so the script sends PowerShell as `-EncodedCommand` (UTF-16LE
  base64). A `prlctl exec` killed on the host keeps running in the VM.
- **Parallels licence.** See
  [windows-support-evaluation.md](windows-support-evaluation.md#the-parallels-vm)
  for the renewal date.

`scripts/windows-vm/run.sh` stays for quick iteration (sync the working tree,
one test filter, a build, a screenshot); see
[windows-support-evaluation.md](windows-support-evaluation.md).
