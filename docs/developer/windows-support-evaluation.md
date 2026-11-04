# Windows support: evaluation (issue #71)

Status: evaluation 2026-10-30; verification updated 2026-10-31; first Windows
build verified in the Parallels VM 2026-11-04 (Phase 0a done, Phase 0 build
fixes done).
Issue: [azeitler/splitkick#71](https://github.com/azeitler/splitkick/issues/71).

## Summary

- **The code is close.** `jean-core` and `src-server` compile and pass
  `clippy -D warnings` for `x86_64-pc-windows-msvc` today. `src-tauri` has
  **2 compile errors** and, behind them, **13 clippy errors** (dead code on
  Windows, one `needless_return`). All are small. After a scratch fix of these,
  all three crates compile for Windows including test targets.
- **The fork's big Unix-only features are already gated.** The detached PI RPC
  host, the relaunch script, Full Disk Access, the app menu and the Dock are
  `cfg`-gated and have a Windows fallback (most of it is upstream code).
  Some fork-only code compiles but is degraded on Windows (Jean import,
  session backup free space, git clients).
- **The real work is CI and release.** The publish pipeline in
  `.github/workflows/preflight.yml` is macOS-only end to end (DMG names,
  `codesign`/`xcrun`, a `latest.json` with only `darwin-aarch64`, the website
  download card). Windows code signing needs a decision and money.
- **Recommendation:** verify in two places. The local Parallels VM (licence
  renewed, now running) is for fast iteration, real UI checks and screenshots
  from an agent session through `prlctl`. GitHub-hosted `windows-latest`
  runners (free, the repo is public) are the native-x64 gate on every push.
  Ship x64 only, NSIS installer only, unsigned first as a pre-release. Decide
  on signing before the first non-pre-release Windows build.

Effort estimate overall: **M–L** (about 4–7 working days to a signed,
auto-updating x64 build; about 1–1½ days to a set-up VM and a green Windows
CI job).

## How this was checked

- Fork baseline: upstream `41390c61` (`docs/upstream/last-sync.json`), not the
  merge base. Upstream: `upstream/main` at `68be32fc` (fetched 2026-10-30).
- Cross-check from macOS: `rustup target add x86_64-pc-windows-msvc`, then
  `cargo clippy --target x86_64-pc-windows-msvc -- -D warnings` per crate (the
  same gate as `bun run rust:clippy`). The C dependencies (`zstd-sys`, `ring`)
  need the Windows SDK headers, and `tauri-winres` needs `llvm-rc`. Neither is
  needed for a type check, because `cargo check` does not link. Stub `cc`, `ar`
  and `llvm-rc` scripts that only write empty output files let the Rust code of
  all crates type-check. This proves the Rust code compiles; it does not prove
  that it links or runs. To repeat:

  ```sh
  export CC_x86_64_pc_windows_msvc=$PWD/tmp/fakecc \
         CXX_x86_64_pc_windows_msvc=$PWD/tmp/fakecc \
         AR_x86_64_pc_windows_msvc=$PWD/tmp/fakear \
         PATH=$PWD/tmp/bin:$PATH   # tmp/bin/llvm-rc stub
  cargo clippy --manifest-path src-tauri/Cargo.toml \
    --target x86_64-pc-windows-msvc -- -D warnings
  ```

  Each stub is a 10-line shell script that writes an empty file for the `-o`,
  `-out:` or `/fo` argument and exits 0. `cargo-xwin` is the full alternative
  (downloads the MSVC CRT and SDK, needs LLVM); it was not installed.

- Not checked: linking, `cargo test` on Windows, `bun run test:run` on
  Windows, a running app. These need a Windows machine (see
  [Verification options](#verification-options)). The Parallels VM is ready
  for this but has no dev tools yet (checked 2026-10-31).

## 1. Compile and clippy results

| Crate        | `cargo check` | `clippy -D warnings` (CI gate) |
| ------------ | ------------- | ------------------------------ |
| `jean-core`  | ok            | ok                             |
| `src-server` | ok            | ok                             |
| `src-tauri`  | **2 errors**  | **+13 errors** after those     |

### src-tauri compile errors (blockers)

| Location                              | Problem                                                                                                                                                                                                                                                                                                                                                   | Fix                                                                                                    | Effort |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------ |
| `src-tauri/Cargo.toml:58`             | `webview2-com = "0.38"`. The fork's Tauri bump to 2.12.3 moved wry to `webview2-com 0.39` (`windows-core 0.62`). Two `windows-core` versions are in the graph, so `add_ProcessFailed(&handler, …)` in `src-tauri/src/platform/windows_webview.rs:104` fails with E0277. Upstream is still on Tauri 2.11.5 + 0.38, so upstream does not have this problem. | `webview2-com = "0.39"` (verified: the error goes away). Keep it in step with wry on every Tauri bump. | S      |
| `src-tauri/src/desktop_commands.rs:4` | `use std::process::{Command, Stdio}`: `Stdio` is used only in the macOS relaunch code (`:586-588`). Unused import = error under `-D warnings`.                                                                                                                                                                                                            | Import `Stdio` inside the macOS block, or `#[cfg(target_os = "macos")]`.                               | S      |

### src-tauri clippy errors (dead code on Windows)

All are fork-only macOS helpers that are not called on Windows:

- `src-tauri/src/app_menu.rs:18,19,22,42` (`KEYBINDING_PREFIX`,
  `COMMAND_PREFIX`, `menu_event`, `keybinding_to_accelerator`)
- `src-tauri/src/desktop_commands.rs:298,310` (`newest_log_file`,
  `show_log_file`)
- `src-tauri/src/dock.rs:26,33` (fields `title`/`target`, `open_session`)
- `src-tauri/src/installed_apps.rs:8,33,42` (`KNOWN_APPS`,
  `installed_tool_ids`, `bundle_id_for`)
- `src-tauri/src/lib.rs:72`: `needless_return` (the `return;` is only
  needed when the macOS line after it exists)

Fix: gate with `#[cfg(any(target_os = "macos", test))]` or
`#[cfg_attr(not(target_os = "macos"), allow(dead_code))]`. Effort S.

`jean-core` with `--all-targets` shows one Windows-only warning,
`jean-core/src/projects/commands.rs:14293` (unused `Backend` import in tests).
CI does not lint test targets, so it is cosmetic. The other `--all-targets`
lints there are not Windows-specific.

**How the fork got here:** upstream fixed the same class of breakage in
`f42fa517 fix(windows): restore cross-platform clippy build` (the fork has it).
Without a Windows CI job, every macOS-only addition can break Windows silently.
That is the main reason to add the CI job first.

## 2. Fork-only and Unix-only code, per area

"Compiles" was verified by the cross-check above. "Works" is from reading the
code and is not verified on Windows.

| Area                                                               | Location                                                                                                                         | Compiles | Works on Windows                                                                                                         | Upstream                                                                                         | Fix / effort                                                                                                                                                                                                                     |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Detached PI RPC host, Unix socket                                  | `jean-core/src/chat/pi.rs:611-895` (`cfg(unix)`), fallback `:897`, `:1358`                                                       | yes      | Yes, as direct `pi --mode json`: the run does not survive a restart, no steering                                         | Same code (`upstream/main:jean-core/src/chat/pi.rs`)                                             | None for v1. A named-pipe host is possible later (L).                                                                                                                                                                            |
| Relaunch (`RELAUNCH_SCRIPT`, `lsappinfo`, `open`, `process_group`) | `src-tauri/src/desktop_commands.rs:518-595`                                                                                      | yes      | Yes: non-macOS uses `app.restart()`                                                                                      | Relaunches via `@tauri-apps/plugin-process`                                                      | None.                                                                                                                                                                                                                            |
| Full Disk Access                                                   | `jean-core/src/platform/full_disk_access.rs:27,53`; UI returns null on `not_applicable`                                          | yes      | Yes (section hidden)                                                                                                     | Not in upstream                                                                                  | None.                                                                                                                                                                                                                            |
| App menu (NSMenu)                                                  | `src-tauri/src/app_menu.rs`, called from `src-tauri/src/lib.rs` macOS block                                                      | yes      | No menu bar; all actions stay reachable through the command palette and shortcuts                                        | Upstream is macOS-only here too                                                                  | Product decision (stay macOS-only). Dead-code fix above (S).                                                                                                                                                                     |
| Dock badge and menu                                                | `src-tauri/src/dock.rs:48-79`, `src/hooks/useDockSync.ts`                                                                        | yes      | No-op                                                                                                                    | Not in upstream                                                                                  | Optional: taskbar overlay badge (M). Not for v1.                                                                                                                                                                                 |
| Installed apps / git clients                                       | `src-tauri/src/installed_apps.rs:44,52`, `desktop_commands.rs:382-424`                                                           | yes      | "Git clients are only supported on macOS"                                                                                | Not in upstream                                                                                  | macOS-only for v1; later via registry App Paths (M).                                                                                                                                                                             |
| WebKit store import, `fix_macos_path`                              | `src-tauri/src/platform/webkit_import.rs`, `src-tauri/src/lib.rs:46-65`                                                          | yes      | Not needed                                                                                                               | Same gating                                                                                      | None.                                                                                                                                                                                                                            |
| Jean import: path rewrite                                          | `jean-core/src/jean_import.rs:340-342`                                                                                           | yes      | **No**: `format!("{}/")` never matches `C:\…` paths, which JSON stores as `C:\\…`. Imported sessions keep the old paths. | Not in upstream                                                                                  | Reuse `rewrite_paths` with the JSON-escaped form from `jean-core/src/chat/transfer.rs:441-458` and `MAIN_SEPARATOR`. S. Tests at `jean_import.rs:496-560` build JSON from raw paths and will fail on Windows; fix them together. |
| Jean import: "is Jean running?"                                    | `jean-core/src/jean_import.rs:190-198`                                                                                           | yes      | Always `false`: import can copy a folder that a running Jean is writing                                                  | Jean on Windows listens on `\\.\pipe\jean-mcp-<hash>` (`jean-core/src/jean_mcp_socket.rs:43-54`) | Open that pipe name with `windows_pipe_path_for_app_data`. S.                                                                                                                                                                    |
| Jean import: symlinks                                              | `jean-core/src/jean_import.rs:285-289`                                                                                           | yes      | Symlinks skipped silently                                                                                                | Not in upstream                                                                                  | Copy the target instead. S.                                                                                                                                                                                                      |
| Session backup: free space                                         | `jean-core/src/session_backup/mod.rs:721-736` (`libc::statvfs`)                                                                  | yes      | Returns `None`: no free-space figure in the estimate                                                                     | Not in upstream                                                                                  | `GetDiskFreeSpaceExW` via `windows-sys` (add `Win32_Storage_FileSystem` to `jean-core/Cargo.toml:49`). S.                                                                                                                        |
| Session backup: atomic rename on a share                           | `jean-core/src/session_backup/mod.rs:390-417`                                                                                    | yes      | Probably; `rename` fails when a reader holds the file open, which is likely on a synced folder                           | Not in upstream                                                                                  | Retry with back-off. S. Needs a real test on a share.                                                                                                                                                                            |
| `shell_open` of file paths                                         | `jean-core/src/platform/process.rs` (`cmd /c start "" <target>`)                                                                 | yes      | Mostly; a path with `&` or `^` is parsed by `cmd`                                                                        | Same code                                                                                        | Use `explorer <path>` for paths. S.                                                                                                                                                                                              |
| MCP socket / stdio proxy, Claude dialog                            | `jean-core/src/jean_mcp_socket.rs:161`, `jean_mcp_stdio.rs:124`                                                                  | yes      | Unknown: named-pipe path exists, fork's dialog additions are untested on Windows                                         | Same file                                                                                        | Test on a runner / VM.                                                                                                                                                                                                           |
| `Command::new` added by the fork                                   | `desktop_commands.rs:14` (`explorer`, `wt`), `projects/commands.rs:4746,4783,4831`                                               | yes      | Yes: these are GUI programs (no console flash). All other fork spawns use `silent_command()`                             | Same pattern                                                                                     | None.                                                                                                                                                                                                                            |
| Managed CLIs on ARM64                                              | `jean-core/src/claude_cli/commands.rs:354` (`win32-x64` only), `jean-core/src/opencode_cli/commands.rs:464` (`windows-x64` only) | yes      | x64: yes. **ARM64 build: no managed Claude/OpenCode install** (Codex has both, `codex_cli/commands.rs:1547-1554`)        | Same (upstream ships x64 only)                                                                   | Only matters if we ship ARM64. M.                                                                                                                                                                                                |

Unchanged upstream Unix code (`detached.rs`, `process.rs` `libc`, `shell.rs`,
`codex.rs`, `opencode_server`, `grok.rs`, `kimi.rs`, `claude.rs`, `terminal/pty.rs`,
the `chmod` calls in the CLI installers) has the same `cfg` gates as upstream.
No action.

### Upstream Windows fixes after the baseline

**Corrected 2026-11-04.** The first version of this list matched commit
subjects against `git log` and said the fork has ten of these fixes. That was
wrong: they are reachable only through the upstream 1.0.1 merge `1cf20d58`,
which `54d762af` reverted. `git merge-base --is-ancestor <commit> 41390c61`
puts every commit below after the baseline, so **none of them is in the tree**.
The VM run proved one of them: without `d499d506` the npm check fails on
Windows (see [VM results](#vm-results-2026-11-04)).

- Windows runtime fixes: `d499d506` npm shims (#678), `f6ce648f` Command Code
  npm detection (#720), `9d1293a4` Cursor Agent install (#719), `89d8a23a`
  Cursor allowlist mode (#721), `3e493909` Claude/Codex session persistence
  (#703), `66554f47` WebView keyboard focus (#736), `a027751e` fnm default
  Node.js, `1232e650` external terminal choices (#842), `24ba7f23` PI through
  WSL (#680), `8e204e61` / `c087a014` WSL terminal CLI args, `2c0f091d`
  managed binaries in user terminals.
- Build and tests: `f42fa517` cross-platform clippy, `b5aeddd8` Windows helper
  warning, `1c296a16` glob paths in tests.
- Other: `d5bb097c` Full-access approve off Ctrl+Y (#822), `be442825` macOS
  folder picker crash (#738).

Take them through `/upstream-review` before a public Windows release. Some
touch files the fork has renamed, so expect manual ports.

## 3. Outside the Rust crates

| Location                                                                              | Problem                                                                                                                                                                                                                                       | Fix                                                                            | Effort   |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------- |
| `scripts/check-branding.mjs:30-36,72-73` (`bun run check:branding`, a preflight step) | `relative()` gives `src\components\…` on Windows. `SKIP_FILE` (`\/test\/`) and `ALLOW_FILES` stop matching, so the check reports false "Jean" hits and fails CI.                                                                              | `rel.split(sep).join('/')`.                                                    | S        |
| `src-tauri/tauri.windows.conf.json:6`                                                 | Window title still `"Jean"` (upstream copy). The fork overlay (`-c tauri.fork.conf.json`) is merged later and replaces the window array, so release builds are fine; plain `tauri build` is not.                                              | Set `"Splitkick"`; update `src/test/tauri-config.test.ts:64`.                  | S        |
| `src-tauri/tauri.fork.conf.json`                                                      | `icons-fork/icon.ico` (`:42`) and `publisher` (`:44`) exist. No `bundle.windows` section (signing, NSIS options), no `plugins.updater.windows.installMode`.                                                                                   | Add `bundle.windows.nsis` (per-user install), `signCommand` once decided.      | S        |
| `package.json:44` `tauri:build:windows`                                               | Builds `msi,nsis`. Two installers double the update and support surface.                                                                                                                                                                      | Ship NSIS only (per-user, no admin, works with `installMode: passive`).        | S        |
| Frontend labels                                                                       | Hard-coded `⌘` in fork-only code: `SessionChatModal.tsx:1525`, `ProjectCanvasView.tsx:781`, `floating-dock.tsx:592`, `DockBurgerButton.tsx:225`. "Open in Finder" hard-coded in `WorktreeDropdownMenu.tsx:322`, `ProjectCanvasView.tsx:3407`. | Use `getModifierSymbol()` / `getFileManagerName()` from `src/lib/platform.ts`. | S        |
| Window chrome                                                                         | Parity with upstream: Windows uses native decorations, the traffic-light inset is macOS-only (`WindowToolbar.tsx:221`). Not checked visually.                                                                                                 | Visual check on Windows.                                                       | S        |
| `e2e/local/` (`launcher.ts:22,53,95,124`, `global-teardown.ts:28`)                    | POSIX/macOS only (`/tmp`, `#!/bin/sh` stub, `/bin/zsh`, `Library/Application Support`, no `.exe`). Not in CI.                                                                                                                                 | Keep macOS-only. The mock e2e (`e2e/`) is portable.                            | M (skip) |
| `scripts/`                                                                            | `build-fork-macos.sh`, `install-local-macos.mjs`, `generate-splitkick-icons.mjs` (`iconutil`) are macOS-only and local. CI scripts (`splitkick-version.mjs`, `changelog-notes.mjs`, `release-cut.mjs`, `web-branding.mjs`) are portable.      | None.                                                                          | —        |

## 4. CI and release

### Today

- `.github/workflows/release.yml` is upstream's workflow and never runs here
  (`if: github.repository == 'coollabsio/jean'`). Re-enabling its Windows row
  does nothing for Splitkick. Leave it alone.
- The fork publishes through `ci-build.yml` → `preflight.yml` with
  `publishFlavor: true`. That file is macOS-only:
  - `windows-latest` is commented out (`preflight.yml:44`).
  - `DMG_NAME` / `UPDATER_NAME` are aarch64 names (`:22-23`).
  - Every publish step is gated on `matrix.platform == 'macos-latest'`; the
    collect step uses `codesign`/`xcrun` (`:209-250`).
  - `latest.json` is written in the macOS job with only `darwin-aarch64`
    (`:257-290`); the release is created in the same job (`gh release create`).
  - Release notes say "Apple Silicon only" (`:369`).
  - `scripts/sync-sites.sh` runs at the end of the macOS job (`:405`).
- Website download card: `Digitalheld/splitkick-website`
  `scripts/sync-release.mjs` hard-codes `Splitkick-aarch64.dmg`, throws without
  a DMG, and rewrites only `version`, `size`, `sha256` in `src/site.ts`
  (`DOWNLOAD = { version, arch: 'Apple Silicon', macos: 'macOS 14 or newer', … }`).
  Read from a local worktree copy, not its `main`.
- `jean-server` (`server-release.yml`) builds Linux only. A Windows server
  binary is not needed for the desktop app. Out of scope.

### What a Windows row needs

1. **Preflight gate (no publish):** uncomment `windows-latest` with
   `preflightArgs: ''`. Fix the src-tauri errors and `check-branding` first.
   Upstream's preflight has exactly this row (`upstream/main:.github/workflows/preflight.yml:33`).
2. **Bundle:** `bun run tauri build --ci --bundles nsis -c src-tauri/tauri.fork.conf.json -c "$UPDATER_CONFIG"`
   in `shell: bash` (Git Bash exists on the runner).
3. **Updater artifacts:** with `createUpdaterArtifacts: true`, Tauri v2 signs
   the NSIS installer itself: `Splitkick_<v>_x64-setup.exe` + `.exe.sig`
   ([Tauri updater docs](https://v2.tauri.app/plugin/updater/)). The same
   minisign key (`SPLITKICK_UPDATER_PRIVATE_KEY`) is used for all platforms.
4. **One `latest.json` for all platforms.** The platform key format is `OS-ARCH`
   (`windows-x86_64`, later `windows-aarch64`), and Tauri validates **every**
   entry in the file before it checks the version, so a broken Windows entry
   would break macOS updates too ([Tauri updater docs](https://v2.tauri.app/plugin/updater/)).
   Because the matrix jobs run separately, move "write latest.json", "publish
   the release" and "sync sites" into a new `publish` job that `needs:` the
   build jobs and downloads their artifacts. This is the largest CI change
   (M). Stable asset names: `Splitkick-x64-setup.exe` plus a versioned copy.
5. **Windows code signing** (see decisions). Configure `bundle.windows.signCommand`
   with the chosen tool; Tauri then signs the app exe and the installer before
   the updater signature is made
   ([Tauri Windows signing](https://v2.tauri.app/distribute/sign/windows/)).
6. **Release notes and site:** platform-neutral notes text; the website card
   gets one entry per platform (`sync-release.mjs` and `src/site.ts` in the
   website repo, M).
7. **Updater install mode:** `plugins.updater.windows.installMode: "passive"`
   (the default) shows a progress bar and needs no input. The app exits before
   the installer runs, which is a Windows installer limit
   ([Tauri updater docs](https://v2.tauri.app/plugin/updater/)). The in-app
   "relaunch after update" path must not assume the macOS script.

### Code signing options

From [Tauri: Windows code signing](https://v2.tauri.app/distribute/sign/windows/)
and [Azure Artifact Signing FAQ](https://learn.microsoft.com/en-us/azure/artifact-signing/faq):

| Option                                                    | How in Tauri                                                                                    | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unsigned                                                  | nothing                                                                                         | Runs, but SmartScreen warns and Windows 11 Smart App Control can block it. Acceptable for pre-releases only.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Azure Artifact Signing (was Trusted Signing)              | `signCommand` with `artifact-signing-cli` (`cargo install artifact-signing-cli`), `AZURE_*` env | Cheapest managed option (Basic tier; the official price page shows no figure, third parties quote about 10 USD/month — verify). Needs a **paid** Azure subscription and identity validation. Reported eligibility: organisations in US/CA/EU/UK, individuals only in US/CA ([pricing](https://azure.microsoft.com/en-gb/pricing/details/artifact-signing/), [JUCE forum](https://forum.juce.com/t/azure-code-signing-for-plugin-developers-guide/60391?page=6)). So it would be in the name of Planetfall Software, if that is an incorporated EU entity. US provider. |
| OV certificate from a CA (e.g. Certum, Poland; cloud HSM) | `signCommand` calling the CA's signing tool, or `certificateThumbprint` for an imported cert    | European option. Since 2023 keys must live on an HSM/token, so CI needs the CA's cloud signing. Tauri's thumbprint guide only covers certs bought before June 2023.                                                                                                                                                                                                                                                                                                                                                                                                    |
| EV certificate                                            | same                                                                                            | Since 2024 EV no longer gives instant SmartScreen reputation; no advantage over OV for us.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

Upstream ships **unsigned** Windows installers (no Windows signing secrets in
`upstream/main:.github/workflows/release.yml`).

## Verification options

### The Parallels VM

Licence: Parallels Desktop 20.4.2, renewed by Andreas, active until
**2026-11-27** (renew again if Windows work runs past that).
VM "Windows 11": **ARM64**, Windows 11 build 10.0.26100, 4 vCPU, 8 GB RAM,
WebView2 Runtime 156, about 213 GB free before setup.

**What it gives us**

- **Native ARM64 Windows**: a real MSVC build and link, `cargo test`,
  `vitest`, and the native ARM64 app.
- **x64 under emulation**: the VM builds the **x64** app (the one we plan to
  ship) with the MSVC x64 cross tools and runs it emulated. Verified
  2026-11-04: it finds WebView2, installs and starts. It does not test native
  x64 hardware or speed; the `windows-latest` runner stays the native-x64 gate.
- **UI and installer checks from an agent session**: `prlctl exec
--current-user` starts GUI apps on the visible desktop (verified), and
  `prlctl capture` takes screenshots.
- **Limits:** 4 vCPU / 8 GB. The first `rust:clippy` + `rust:test` run takes
  longer than 10 minutes; an x64 `release-fast` build takes about 11 minutes of
  cargo time. Only one session at a time can use the VM.

**Scripts** (`scripts/windows-vm/`, added 2026-11-04)

| Command                       | What it does                                                                                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run.sh share`                | Shares the checkout read-only as `\\Mac\splitkick` (`--shf-host on` plus `--shf-host-add`). Parallels reinstalls its guest tools after the first change; wait for it. |
| `run.sh setup`                | `setup.ps1 -Part machine` as SYSTEM, then `-Part user` as the logged-in user. Safe to re-run.                                                                         |
| `run.sh sync`                 | `robocopy /MIR` to `C:\src\splitkick`, without `node_modules`, `target`, `tmp`, `dist`, `.git` (the VM keeps its own).                                                |
| `run.sh gate`                 | sync + the preflight checks (`vm.ps1 -Step gate`).                                                                                                                    |
| `run.sh build [x64\|arm64]`   | sync + `tauri build --bundles nsis -c tauri.fork.conf.json -- --profile release-fast`.                                                                                |
| `run.sh smoke [x64\|arm64]`   | Starts the built exe, checks it is still up after 25 s and that it wrote a log, prints the log tail and `[ERROR]` lines.                                              |
| `run.sh shot [name]` / `stop` | Screenshot to `tmp/<name>-<stamp>.png` / quit Splitkick.                                                                                                              |

Tools installed by `setup.ps1` (winget IDs checked 2026-10-31; Chocolatey is
not needed): `Microsoft.VisualStudio.2022.BuildTools` 17.14 with the VCTools
workload plus the ARM64, x64 and Clang components (`ring` needs clang on ARM64
Windows, [ring BUILDING.md](https://github.com/briansmith/ring/blob/main/BUILDING.md)),
`Git.Git`, `OpenJS.NodeJS.LTS`, a Defender exclusion for `C:\src` and the
cargo/rustup folders (machine part, as SYSTEM); `Rustlang.Rustup` with the
`x86_64-pc-windows-msvc` target and `Oven-sh.Bun` (user part). See the
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) and
[Bun install docs](https://bun.com/docs/installation).

**Pitfalls found during setup**

- `prlctl exec` without `--current-user` runs as SYSTEM, where `winget` is not
  on PATH. Calling the App Installer's `winget.exe` directly fails with
  `0xC0000135` (DLL not found) until its VCLibs / UI.Xaml framework folders
  are on PATH; `setup.ps1` adds them. Installing as SYSTEM avoids the UAC
  prompt that machine-wide installers raise for the user.
- `prlctl exec` drops one backslash of a leading `\\` and strips double quotes
  inside arguments. `run.sh` passes UNC paths in single quotes and runs longer
  logic from `.ps1` files.
- A `prlctl exec` that the host kills (for example by a tool timeout) keeps
  running in the VM without an output pipe. Run long steps with `nohup` and a
  log file on the host.

### VM results (2026-11-04)

Build from branch `71-evaluate-windows-support` with `origin/main` merged
(Splitkick 1.4.1), with the Phase 0 build fixes applied.

| Check                          | Result                                                                                                                                                                     |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun install`, typecheck, lint | pass                                                                                                                                                                       |
| `rust:clippy -D warnings`      | pass (native ARM64; all three crates)                                                                                                                                      |
| `test:run` (vitest)            | pass, 457 of 457 files                                                                                                                                                     |
| `check:branding`               | pass (after the path-separator fix)                                                                                                                                        |
| `rust:test` (jean-core)        | **1441 pass, 11 fail, 2 ignored**; `src-server` and `src-tauri` tests did not run because the script stops at the first failure                                            |
| x64 NSIS build                 | pass: `Splitkick_1.4.1_x64-setup.exe`, 24.6 MiB                                                                                                                            |
| Smoke start (x64, emulated)    | pass: window "Splitkick" with native Windows title bar, onboarding renders, WebView2 ProcessFailed recovery installed, MCP named pipe `\\.\pipe\splitkick-mcp-…` listening |
| Silent install (`/S`)          | pass: per user to `%LOCALAPPDATA%\Splitkick`, no admin, uninstall entry with publisher "Planetfall Software", desktop shortcut; the installed copy starts                  |

The 11 test failures are test portability problems, not code defects:

- 6 × `projects::commands::tests::resolve_file_reference_*`: the code returns
  native `\` paths; the tests build the expected value with `format!("{}/…")`.
- `jean_mcp_core::tests::create_graph_by_path_and_by_project`: `repo\.splitkick/graphs/…`
  vs `repo/.splitkick/graphs/…` — both valid; compare `Path`s, not strings.
- `graphs::tests::location_detection_and_commit`: the message shows
  `docs\roadmap.yml`; the test expects `/`. Decide whether repo-relative
  paths in messages use `/` on every OS (git does).
- `jean_mcp_core::tests::open_in_browser_resolves_local_files`: the test
  canonicalizes the expected path, which adds the `\\?\` prefix on Windows.
- `chat::transfer::tests::import_recreates_the_session_as_a_handoff_fork`: the
  test looks for the raw path in a JSON log, where `\` is escaped as `\\`.
- `opencode_cli::…::get_platform_asset_returns_valid_name`: no Windows ARM64
  asset (`jean-core/src/opencode_cli/commands.rs:464`). Expected on the ARM64
  host; passes on x64.

Defects found in the running app:

- **npm-based CLIs cannot install or update on Windows.** A
  "Failed to update Command Code CLI — requires Node.js and npm" toast appears
  at start-up although Node and npm are installed. `version("npm")` in
  `jean-core/src/prerequisites.rs:20` runs `silent_command("npm")`, and Rust's
  `Command` only appends `.exe`, so `npm.cmd` is never found. The installs
  themselves also run `silent_command("npm")`:
  `commandcode_cli/commands.rs:709`, `grok_cli/commands.rs:678`,
  `pi_cli/commands.rs:645`, `kimi_cli/commands.rs:413`,
  `agent_browser/mod.rs:306`. Upstream fixed both in `d499d506` (#678) and
  `f6ce648f` (#720): `prerequisites::version` uses
  `platform::detect_cli_in_path`, and npm shims launch through a resolver.
  Lost in the 1.0.1 revert. M.
- **Updater keys.** The update check fails as expected (no Windows entry in
  `latest.json`). The installed NSIS build asks for `windows-x86_64-nsis`
  first, then `windows-x86_64`; the raw exe asks only for `windows-x86_64`.
  Write the Windows entry as `windows-x86_64` (or both).
- The floating dock shows the `⌘` symbol (known, Phase 1 label fix).

Screenshots: `tmp/splitkick-windows-x64-20261104-144505.png` (raw build),
`tmp/splitkick-windows-installed-20261104-144617.png` (installed copy); `tmp/`
is not committed.

### Other options

| Option                              | Cost                                                                                                                                                                                                             | Good for                                                                                                                                                                            | Limits                                                                |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **GitHub `windows-latest` runners** | Free (public repo); `windows-11-arm` also free for public repos ([Windows blog](https://blogs.windows.com/windowsdeveloper/2025/04/14/github-actions-now-supports-windows-on-arm-runners-for-all-public-repos/)) | Native x64 build, link, `cargo test`, `vitest`, NSIS bundle, a headless smoke start. Repeats on every push. Needs a push.                                                           | No interactive UI. Each run starts from zero (cache helps).           |
| UTM (free, open source)             | Free                                                                                                                                                                                                             | Fallback if the Parallels licence is not renewed after 2026-11-27 ([guide](https://www.thurrott.com/windows/windows-11/301460/quick-hands-on-macbook-air-m3-utm-windows-11-on-arm)) | New VM install, slower graphics, some driver issues on 24H2 reported. |

**Recommendation:** the Parallels VM for local iteration, UI checks and
screenshots (no push needed, an agent session can drive it); the
`windows-latest` preflight row as the native-x64 gate on every push. UTM only
as a fallback after 2026-11-27.

## Product decisions (open)

1. **Architecture:** x64 only (recommended; upstream ships x64 only, and x64
   runs on Windows ARM by emulation) or x64 + ARM64 (needs `win32-arm64`
   mappings for the managed Claude and OpenCode installs, a second runner and a
   second updater entry).
2. **Signing:** unsigned pre-releases only, Azure Artifact Signing (in the
   company's name), or a European OV certificate (e.g. Certum). Needed before
   a non-pre-release Windows build.
3. **macOS-only features:** recommended to stay macOS-only in v1: native menu
   bar, Dock badge/menu, git-client launcher, Full Disk Access, WebKit store
   import, survivable (detached) PI runs, `e2e/local`. Everything else must work.
4. **Installer:** NSIS only (recommended) or NSIS + MSI.
5. **Release channel:** Windows as `-rc` pre-releases first, or straight to
   the stable channel.

## Phased plan

**Phase 0a — VM setup. Done 2026-11-04.**

- `scripts/windows-vm/setup.ps1`, `vm.ps1`, `run.sh`; shared folder on; tools
  installed. Both open points confirmed: the emulated x64 app finds WebView2,
  and `--current-user` starts the GUI on the visible desktop.

**Phase 0 — a green Windows gate. Build fixes done 2026-11-04; CI row open.**

- Done: `webview2-com = "0.39"`, `Stdio` behind the macOS gate, the 13
  dead-code / `needless_return` lints, `check-branding.mjs` separators.
- Open: fix the 10 portable test failures (S), then run `run.sh gate` until it
  passes, then add `windows-latest` (`preflightArgs: ''`) to the
  `preflight.yml` matrix. Adding the row before the tests pass would turn every
  push red.
- Result: Windows breakage is caught on every push.

**Phase 1 — functional fixes (M, about 2–3 days).**

- Port the upstream Windows fixes lost in the 1.0.1 revert, starting with npm
  shims (`d499d506`, `f6ce648f`): the npm-based CLIs (Command Code, Grok, PI,
  Kimi, agent-browser) cannot install on Windows today. Then the others listed
  under [Upstream Windows fixes](#upstream-windows-fixes-after-the-baseline),
  through `/upstream-review`.
- `jean_import`: path rewrite, running-Jean check over the named pipe, symlink
  copy.
- `session_backup`: free space via `GetDiskFreeSpaceExW`, retrying rename.
- `shell_open` paths via `explorer`; `⌘` and "Finder" labels.
- `tauri.windows.conf.json` title; `bundle.windows.nsis` in the fork overlay.
- Smoke start step in CI; a UI pass in the VM (onboarding, a project, a
  session with Claude and Codex, terminal, file browser) with screenshots.

**Phase 2 — unsigned pre-release (M, about 1–2 days).**

- NSIS bundle with updater artifacts on `windows-latest`.
- Split publishing into a `publish` job that merges `darwin-aarch64` and
  `windows-x86_64` into one `latest.json`, creates the release and runs
  `sync-sites.sh` once.
- Platform-neutral release notes; first Windows build as an `-rc`.
- Verify an in-app update rc → rc on Windows in the VM (install the older rc
  with the NSIS installer, let the app update itself).

**Phase 3 — signed stable release (M, depends on the certificate lead time).**

- Signing via `signCommand` in CI.
- Website: one download card per platform (`sync-release.mjs`, `src/site.ts`
  in `Digitalheld/splitkick-website`); docs for Windows install.

**Phase 4 — optional.** ARM64 build (the VM already tests it natively),
taskbar badge, Windows git-client launcher, survivable PI runs over a named
pipe.
