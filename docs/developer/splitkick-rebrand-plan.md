# Splitkick rebrand plan

> Date: 2026-10-14. Base: JeanZ `0.1.73-z.25` on upstream Jean 0.1.73. Status: plan, no code changed.
> "unverified" = not confirmed in code or docs during planning.

## Context

The fork "JeanZ" becomes **Splitkick**, the public, free power-user edition of Jean, published by Planetfall Software. The website (`~/LocalProjects/splitkick-website`) and docs (`~/LocalProjects/splitkick-docs`) already exist; this plan covers only the app (spec part C, `makerstuff/splitkick/docs/2026-10-14-splitkick-design.md`). Success criteria from the spec: a signed, notarized DMG that installs next to Jean (own bundle id, own data folder) and updates from Splitkick's own feed; every feature claim on the site matches the app.

Two facts change the brief:

1. **JeanZ does not have its own data dir.** Its bundle id is `com.jean.desktop.jeanz`, but `jean-core/src/runtime.rs:19` pins `DATA_DIR_NAME = "com.jean.desktop"`. JeanZ and Jean share `~/Library/Application Support/com.jean.desktop`. Only WebKit storage, window state and logs follow the bundle id (`~/Library/WebKit/com.jean.desktop.jeanz`, `…/com.jean.desktop.jeanz/.window-state.json`). JeanZ-only files in the shared dir: `ui-state_jeanz.json`, `activity_jeanz.jsonl` (`jean-core/src/lib.rs:3705-3725`, `activity/mod.rs:26`). So "import from Jean" and "import from JeanZ" read the **same** dir; they differ only in which ui-state/activity/WebKit files to take.
2. **"Keeps history for ever" is false today**, and not only because of the 7-day archive default. See part B.

---

## Part A — Identity

### A1. Names and identifiers

| Item                    | Today (JeanZ)                                        | Splitkick                                                                                                                     | Note                                                                                                                          |
| ----------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Product name            | `JeanZ`                                              | `Splitkick`                                                                                                                   | Capital S in all prose and UI. Lowercase only where the platform needs it (paths, ids, binary/MCP names).                     |
| Bundle id               | `com.jean.desktop.jeanz`                             | `app.splitkick.desktop`                                                                                                       | Reverse DNS of `splitkick.app`, which Andreas owns. Accepted.                                                                 |
| Dev bundle id           | `com.jean.desktop.dev`                               | `app.splitkick.desktop.dev`                                                                                                   | Today Jean dev and JeanZ dev share it.                                                                                        |
| Data dir                | `…/com.jean.desktop` (shared)                        | `…/app.splitkick.desktop`                                                                                                     | Data dir = bundle id again. The `_jeanz` file-name suffix is no longer needed.                                                |
| Worktree root           | `~/jean/<project>/`                                  | `~/splitkick/<project>/` for **new** worktrees                                                                                | Imported worktrees stay where they are (A3). Lowercase like `~/jean`.                                                         |
| Skills dir              | `~/.jean/skills/<backend>`                           | `~/.splitkick/skills/<backend>`, fallback read from `~/.jean/skills`                                                          | `opinionated/commands.rs:1349`, `projects/commands.rs:13787`, `chat/commands.rs:3834`.                                        |
| Executable              | `JeanZ.app/Contents/MacOS/jean`                      | `Splitkick.app/Contents/MacOS/splitkick`                                                                                      | Use Tauri v2 `mainBinaryName` in the overlay, not a Cargo rename (unverified that it works with the MCP stdio shim; test it). |
| MCP server name         | `jean`, `jean-dev`, `jean-dialog`                    | `splitkick`, `splitkick-dev`, `splitkick-dialog`                                                                              | `jean_mcp_config.rs:58-62`, `chat/jean_mcp.rs:58`. Tool prefix becomes `mcp__splitkick__*`.                                   |
| MCP socket              | `<data>/jean-mcp.sock`                               | `<data>/jean-mcp.sock` in the new dir                                                                                         | Different dir → no clash. File name unchanged (internal).                                                                     |
| Codex socket fallback   | `$TMPDIR/jean-codex-<uid>.sock`                      | `$TMPDIR/splitkick-codex-<uid>.sock`                                                                                          | Real clash when both apps run.                                                                                                |
| Web Access default port | 3456                                                 | **3460**                                                                                                                      | Both apps share 3456 today.                                                                                                   |
| Per-project config      | `jean.json`                                          | read `splitkick.json`, else `jean.json`; write back to the file that exists; create `splitkick.json` only when neither exists | Repos shared with Jean users keep working. `projects/git.rs:2138`, `commands.rs:5084, 14097`.                                 |
| Data dir env override   | `JEAN_DATA_DIR`                                      | `SPLITKICK_DATA_DIR`, `JEAN_DATA_DIR` still read                                                                              | `runtime.rs:32-46`.                                                                                                           |
| Usage cache             | `~/Library/Caches/jean/usage-cache`                  | keep for now                                                                                                                  | Shared cache is harmless (unverified for parallel writes). Low priority.                                                      |
| Update feed             | `azeitler/jean/releases/latest/download/latest.json` | `azeitler/splitkick/releases/latest/download/latest.json`                                                                     | A4.                                                                                                                           |

**Keep internal identifiers that users do not see** (Rust crates `jean`/`jean-core`, env vars `JEAN_MCP_*`, localStorage keys `jean-*`, `JeanWebBuildInfo`, socket file names). Every renamed internal identifier is a future merge conflict and buys nothing.

### A2. Branding overlay (keeps upstream merges cheap)

Principle: `src-tauri/tauri.conf.json` stays byte-identical to upstream, as today. All Splitkick values live in a few files.

- **New `jean-core/src/brand.rs`** (one module, about 20 lines): `PRODUCT_NAME`, `DATA_DIR_NAME`, `DEV_DATA_DIR_NAME`, `MCP_SERVER_NAME` (+ dev, dialog), `WORKTREE_ROOT_DIR`, `SKILLS_DIR`, `PROJECT_CONFIG_FILE` (+ legacy name), `DEFAULT_HTTP_PORT`, `DESKTOP_MANIFEST_URL`, `SERVER_MANIFEST_URL`. Plain constants, no flavor switch. The fork builds only Splitkick; plain Jean is built from upstream.
- Replace the literals at their single use sites: `runtime.rs:19,26`, `projects/storage.rs:28-62`, `jean_mcp_config.rs:58-62, 210-217`, `chat/jean_mcp.rs:58`, `projects/git.rs:2138`, `server_update/mod.rs:27-58`, `lib.rs:261, 864`, `remote_install.rs:14`.
- **Remove the JeanZ product-name switch**: `PRODUCT_NAME_JEANZ` (`jean-core/src/lib.rs:3705`), `resolve_product_name` (`src-tauri/src/lib.rs:90-98`), the `_jeanz` file names. In an own data dir, plain `ui-state.json` / `activity.jsonl` are correct.
- **`src-tauri/platform/flavor_seed.rs`**: today it copies WebKit/window state from Jean on first start. Replace it with the import flow (A3). Do not seed silently.
- **`src-tauri/tauri.fork.conf.json`**: productName, identifier, title, `mainBinaryName`, icons, publisher "Planetfall Software", copyright, descriptions, updater endpoint + new pubkey. Keep the file name (scripts and CI reference it).
- **`src-tauri/tauri.conf.dev.json`**: dev identifier and title "Splitkick (Dev)".
- **Frontend**: `scripts/web-branding.mjs` (`FORK_PRODUCT_NAME='Splitkick'`, also rewrite `public/manifest.webmanifest`, which is not rewritten today), `src/lib/build-info.ts` (add `UPSTREAM_BASE_VERSION` = version of the untouched base `tauri.conf.json`, for "Built on Jean 0.1.73"), `src/lib/release-url.ts` (one repo URL, see A4 for tags), `vitest.config.ts:13`.
- **Links**: `SidebarFooter.tsx:113-122` and `MobileSettingsPage.tsx:144-150` → Splitkick repo + `splitkick.app`; remove "Sponsor Jean" (keep a "Built on Jean" credit link to coollabsio/jean in About). `GeneralPane.tsx:5009` commit link → Splitkick repo.
- **`src/services/model-catalog.ts:10`**: keep the coolLabs CDN catalog (read-only data, works). Note in NOTICE. Unverified whether coolLabs wants third-party clients to use it; ask in the message to Andras.
- **UI strings**: about 326 lines in about 106 `src/` files and about 261 Rust lines contain "Jean". Do one sweep: user-visible strings use `PRODUCT_NAME` (TS) / `brand::PRODUCT_NAME` (Rust, also agent-facing prompts such as "running inside Jean"). Leave comments and identifiers. `ToolCallInline.tsx:94-101, 198` and `claude_dialog_tool.rs:151` must recognize **both** `mcp__jean__` (imported history) and `mcp__splitkick__`.
- **Guard**: new `scripts/check-branding.mjs` (+ `bun run check:branding` in `check:all`) greps user-visible "Jean"/"JeanZ" string literals in `src/` and Rust string literals, with an allowlist ("Built on Jean", credits, legacy `jean.json`, `mcp__jean__`). After every upstream merge it lists the new strings to fix. This keeps the string sweep cheap to redo.
- **Icons**: replace `scripts/generate-fork-icon.mjs` (hue rotation) with `scripts/generate-splitkick-icons.mjs`: `rsvg-convert` (installed, `/opt/homebrew/bin`) renders `design/logo/final/icon.svg` to a 1024 px PNG (rsvg renders strokes, so no stroke-to-fill step is needed for this path), then `bun tauri icon` → `src-tauri/icons-fork/`. Overwrite 16/32 px with mark A4 (`favicon.svg`) and rebuild `icon.icns` with `iconutil`. Web: favicon + apple-touch-icon into `icons-fork/web/`. The stroke-to-fill conversion is needed only if ImageMagick stays in the pipeline. Do not use it. `icon.svg` already has the macOS grid (824 px squircle in 1024 px canvas).
- **Repo files**: README (rewrite; fix the stale bundle-id line 85), new `NOTICE` (Apache 2.0 §4: "Splitkick, © 2026 Planetfall Software. Includes Jean, © 2025 Andras Bacsai / coolLabs, Apache 2.0", list modified files statement), keep `LICENSE.md`, `SECURITY.md` (Planetfall contact, not `security@coollabs.io`), `CONTRIBUTING.md`, `.github/FUNDING.yaml` (delete or Planetfall), `ISSUE_TEMPLATE/*` (Splitkick repo, field `splitkick_version`), `package.json` (`name`, `author`, keep `license`), `install-local-macos.mjs:18-19,164` (`/Applications/Splitkick.app`), `scripts/release-cut.mjs:101` and `scripts/claude-dialog-rig/run.sh:21` (gh path).
- **Not now**: headless server (`jean-server`, `scripts/install-jean-server.sh`, Dockerfiles, `remote_install.rs:16` installer URL). The site lists the Splitkick server build as "Planned". Remote install keeps installing upstream `jean-server`, labelled "Jean server" in the UI. Protocol compatibility between Splitkick desktop and upstream 1.0.x servers: unverified (the 1.0.1 merge broke remote ids).

**Files that diverge from upstream because of the brand** (expected merge-conflict surface): `brand.rs` (new), `runtime.rs`, `projects/storage.rs`, `projects/git.rs`, `jean_mcp_config.rs`, `chat/jean_mcp.rs`, `server_update/mod.rs`, `lib.rs` (port default), `src-tauri/src/lib.rs`, `tauri.fork.conf.json`, `tauri.conf.dev.json`, `build-info.ts`, `release-url.ts`, `web-branding.mjs`, `SidebarFooter.tsx`, `MobileSettingsPage.tsx`, `GeneralPane.tsx`, `ToolCallInline.tsx`, `icons-fork/`, repo meta files, workflows, plus the string sweep (guarded by `check-branding`).

### A3. Takeover from Jean / JeanZ (first start)

**Detection** (new jean-core module `import/` with commands `detect_import_sources`, `import_from_jean`; register in `jean-core/src/http_server/dispatch.rs`; desktop-only in UI):

- Source dir: `dirs::data_dir()/com.jean.desktop` (Jean and JeanZ), plus `JEAN_DATA_DIR` if set. Report: project count, session count, size, last modified, whether `ui-state_jeanz.json` exists (JeanZ user), Jean version if known (unverified where the version is stored; maybe none).
- WebKit sources: `~/Library/WebKit/com.jean.desktop` and `~/Library/WebKit/com.jean.desktop.jeanz` (remote hosts, `jean-http-token`, zoom live in localStorage, `src/lib/remote-connections.ts:6-8`).
- Show the dialog only when the Splitkick data dir has no `projects.json`. Settings → Advanced "Import from Jean…" is offered only while Splitkick has no projects (no merge of two data sets; too complex for the value).

**Options shown:**

- **(a) Import a copy (default).** Copy, never move, never write to the source.
- **(b) Start fresh.**
- **(c) Use the existing Jean dir: not offered in the UI.** Assessment: the format is identical for Jean 0.1.73 and JeanZ (JeanZ shares it today), but two apps writing one `projects.json`, `preferences.json`, sessions and `jean-mcp.sock` at the same time is exactly the side-by-side problem we remove. Upstream Jean 1.0.x adds multi-server ids (`local:` prefixes broke the 1.0.1 merge) and other fields; whether 0.1.73-based code tolerates a dir written by 1.0.x, and the reverse: unverified, assume no. Power users can still set `SPLITKICK_DATA_DIR`; document it as unsupported.

**Copy procedure:**

1. Ask the user to quit Jean/JeanZ; detect a live instance (connect to `<source>/jean-mcp.sock`; unverified that this is reliable) and refuse while it runs.
2. Copy the whole source dir into `<splitkick data>/.import-tmp/` **except** a denylist: `*.sock`, `*.pid`, `r/`, `k/`, `grok-acp/`, `pi-rpc-hosts/`, `kimi-acp-hosts/`, `grok-acp-hosts/`, `codex-app-server.*`, `opencode-server.pid`, `logs/`, `recovery/`, `*-versions-cache.json`. Copy-all-minus-denylist is simpler and future-proof versus an allowlist. Managed CLIs (`claude-cli/`, `gh-cli/`, …) are copied so `source = jean` backends keep working.
3. JeanZ source: rename `ui-state_jeanz.json` → `ui-state.json`, `activity_jeanz.jsonl` → `activity.jsonl`. Jean source: use the plain files.
4. Rewrite absolute paths: text replace of the exact prefix `…/com.jean.desktop/` → `…/app.splitkick.desktop/` in `sessions/**/metadata.json`, `sessions/**/*.jsonl`, `session-context*`, `git-context/references.json`, `preferences.json`. Pasted images/texts are referenced by absolute path (the attached working dirs in this session prove that). Also add a read fallback (`src/lib/transport.ts:111` already has a `com.jean.desktop/` marker) that maps an old-prefix path to the new dir when the file is missing. The rewrite is exact-prefix only; it does not touch prose otherwise.
5. Preferences: if `http_server_port == 3456` → 3460. If `archive_retention_days == 7` (Jean's default) → 0 and say so in the summary; keep other explicit values (Andreas has 14). If `removal_behavior == "delete"` (default) → `"archive"` and say so. Keep `http_server_token` (phone pairing still works on the new port; the token stays a secret in a file only the user can read).
6. Atomic `rename` of `.import-tmp` contents into place, then `app.restart()`, so no store loads a half-copied state.
7. WebKit: copy the chosen WebKit dir (JeanZ if present, else Jean) into `~/Library/WebKit/app.splitkick.desktop` before the webview starts (reuse the copy logic from `flavor_seed.rs`). Unverified that a copied WebKit localStorage DB opens under a new bundle id; `flavor_seed.rs` relies on it already, so likely yes.
8. Summary screen: what was copied, what was changed (port, retention, removal behavior), source untouched, total size.

**Worktrees: keep in place and reference.** `Worktree.path` is absolute in `projects.json`. Moving them would break Claude resume (Claude keys transcripts by cwd under `~/.claude/projects/<encoded-cwd>/`), break open editors/terminals, and touch user files. New worktrees of imported projects go to `~/splitkick/<project>/`. Risk: Jean can still archive/delete a shared worktree (PR-merge auto-archive with `delete`). Today a missing worktree folder makes Splitkick drop the record and then delete its session history as orphans. Fix B3 must land before import ships.

**Shared conversations**: after import, a Claude/Codex session id exists in both apps. Resuming it in both forks the native transcript in two directions. Not preventable without touching the source. Document: "After import, continue imported sessions in Splitkick only."

**MCP during transition**: Splitkick registers only `splitkick` in `~/.claude.json`, `~/.codex/config.toml`, etc. (`jean_mcp_config.rs:317-409`) and never edits or removes the `jean` entry; each entry points to its own executable and socket. Claude runs started by Splitkick get `--strict-mcp-config` with `splitkick` only (`chat/claude.rs:1202-1240`). Imported preferences/system prompts that say "Jean MCP" / `mcp__jean__…` are user text; the summary screen lists them (simple grep), no automatic rewrite.

**Keychain**: Jean has no own keychain items; it only reads `Claude Code-credentials` and `Codex Auth` (owned by the CLIs). Nothing to migrate. Web Access token: in `preferences.json` (plain). Remote hosts: WebKit localStorage (step 7).

**Format policy: keep upstream's on-disk format, no own version number.** Splitkick only adds `#[serde(default)]` fields, as JeanZ does. This keeps import trivial and a later upstream merge cheap. Add a `data_format` marker only when a breaking change is unavoidable. A later upstream merge that changes the format (multi-server ids) needs a one-way migration step with a backup copy (`<data>.backup-<date>`), because the updater cannot downgrade.

**macOS side effects of the new bundle id**: notification, folder and automation permissions are asked again (expected); login items none.

### A4. Release pipeline

- **Signing/notarization**: CI secrets on the Splitkick repo: `APPLE_CERTIFICATE` (Planetfall Developer ID Application .p12), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY` ("Developer ID Application: Planetfall Software … (TEAMID)"), `APPLE_TEAM_ID`, notarization via `APPLE_ID` + app-specific `APPLE_PASSWORD` (or an App Store Connect API key). The base `tauri.conf.json` keeps coolLabs' identity (upstream file); the overlay already overrides it with `"-"` and CI injects the real identity. Unverified: which certificate the current JeanZ secrets hold. Check before reuse; must be Planetfall's.
- **Updater key**: new minisign key for Splitkick (do not reuse the JeanZ key; a separate key keeps JeanZ installs from accepting Splitkick artifacts, see A5). Store `~/.splitkick/updater.key{,.password,.pub}` + 1Password; secrets `SPLITKICK_UPDATER_PRIVATE_KEY{,_PASSWORD}`; pubkey into `tauri.fork.conf.json` and `tauri.conf.dev.json` (test in `server_update/mod.rs:985-1006` keeps them in step).
- **`.github/workflows/preflight.yml`**: `DMG_NAME: Splitkick-${VERSION}-aarch64.dmg` (versioned, as requested). Also upload a constant-name copy `Splitkick-aarch64.dmg` so the website button can use `releases/latest/download/Splitkick-aarch64.dmg` (decide; the site needs a stable URL). Updater archive `Splitkick.app.tar.gz`, paths `macos/Splitkick.app`, artifact `splitkick-macos-arm64-<version>`, release title `Splitkick <version>`, `latest.json` notes. `JEAN_FLAVOR` becomes unnecessary once `web-branding.mjs` defaults to Splitkick; remove.
- **`release.yml`** (upstream's "Release Jean"): add `if: github.repository == 'coollabsio/jean'` to every job (one line per job, upstream-friendly). Its tag filter (`-z`) no longer protects us.
- **Version scheme**: `1.0.0` for the first public release, then plain semver; `rc` pre-releases for test feeds (`1.0.0-rc.1`). "Built on Jean 0.1.73" in About (from `UPSTREAM_BASE_VERSION`) and in each changelog entry. Replace `scripts/jeanz-version.mjs` (z-counter from tags) with reading the version from the overlay/`package.json` and bumping in `release-cut.mjs`. Rationale: `-z.N` only made sense as "upstream + patches"; Splitkick is its own product and its version must not jump when the base changes.
- **Tag collision**: the local repo has upstream tags `v1.0.0`…`v1.0.11`. A Splitkick `v1.0.0` tag collides with them locally. Use tag prefix **`splitkick-v1.0.0`**, and set `git config remote.upstream.tagOpt --no-tags` so upstream tags stop arriving. Update `release-url.ts` and the release-cut script for the prefix.
- **Changelog**: keep `CHANGELOG.md` in the repo (one line per change in the GitHub release, detail in the file; existing rule). Release notes for the docs portal are written in `splitkick-docs` (out of scope).
- **Repo: rename `azeitler/jean` → `azeitler/splitkick`, stay in the fork network.** Facts: the repo is public, a fork of `coollabsio/jean`, 25 MB, 0 child forks, 1 star. A rename keeps issues, history and the visible "forked from coollabsio/jean" credit; GitHub redirects web and git URLs (Actions references do not redirect; reusing the old name breaks redirects). Staying in the network is required to open upstream PRs from this repo (A6/part D). A detached clean repo looks tidier but loses issues and the PR path, and "Leave fork network" cannot be undone. Downside: forks rank lower in GitHub search; acceptable, the website is the entry point. Unverified: whether `/releases/latest/download/…` follows the rename redirect; test with `curl -I` right after the rename (it matters for A5). Alternative if Andreas wants a Planetfall org: transfer later; same redirect rules.

### A5. JeanZ users (bridge release)

The Tauri updater replaces the running `.app` in place. Letting `JeanZ.app` update into a Splitkick build would leave a `JeanZ.app` with bundle id `app.splitkick.desktop` and the old shared data dir. Do not do that.

1. Ship **`0.1.73-z.26`** (last JeanZ) before the repo rename. It points its updater at a fixed asset that never changes (`releases/download/jeanz-final/latest.json`, which lists z.26 itself), and shows a one-time notice "JeanZ is now Splitkick — download" with the link.
2. Only then rename the repo. JeanZ z.25 installs that never updated follow the redirect to Splitkick's `latest.json`; the signature check with the old JeanZ key fails, so nothing installs (an update error shows). Acceptable for the small JeanZ user base; the README says how to move.
3. JeanZ users install Splitkick next to JeanZ and use the import dialog (source = shared `com.jean.desktop`, JeanZ ui-state).

---

## Part B — Retention: what "for ever" means

### B1. Facts (verified in code)

- **Splitkick keeps its own full copy.** The UI reads only Jean's run logs: `sessions/data/<sid>/metadata.json` + `<run_id>.jsonl` (`run_log::load_session_messages_window`, `run_log.rs:1362`; `chat/commands.rs:913-928`). For OpenCode, Cursor, Pi, Command Code, Grok and Kimi, Jean also writes Claude-format lines (`chat/commands.rs:5356-5450`). The Claude Code 30-day sweep and the Gemini CLI 30-day sweep do **not** delete chat history in Splitkick. (The features doc cites `SessionMetadata.messages`; the actual store is the run-log JSONL. Fix the wording there.)
- `native_history.rs` reads Claude/Codex/Cursor/OpenCode/Antigravity stores only to list native sessions for import/terminal resume, not to show Jean chats.
- **But the model's context depends on native stores.** Resume ids point to native transcripts. When they are gone: Claude starts a new conversation under the old id (`claude.rs:309-338`, `commands.rs:436-445, 3672-3685, 3758-3780`); Codex starts a new thread (`codex.rs:1089-1103`); OpenCode, Cursor, Pi have no fallback (`opencode.rs:2888-2918`, `cursor.rs:1060-1078`, `pi.rs:1364-1367`). The UI still shows the history; the agent silently forgot it.
- **Deletion paths with default settings** (all verified):
  - `archive_retention_days` default 7 (`jean-core/src/lib.rs:645-647`, `src/types/preferences.ts:2349`); fallbacks `?? 30` in `GeneralPane.tsx:4909`, `maintenance-commands.ts:36`. Cleanup at every app start (`useArchiveCleanup.ts`) deletes archived worktrees (incl. git dir and branch) and archived sessions with all run logs (`projects/commands.rs:12445-12636`). 0 already means never for this path.
  - `removal_behavior` default `"delete"` (`lib.rs:1410-1412`, `preferences.ts:2377`): Cmd+W / close deletes the session data (`chat/commands.rs:1981-2016`).
  - `close_original_on_clear_context` default on: plan handoff closes (= deletes) the original session (`plan-handoff.ts:47-56, 112-113`). Upstream issue [coollabsio/jean#795](https://github.com/coollabsio/jean/issues/795); upstream fix `bf10f321` "archive original plan session instead of deleting it".
  - PR-merge auto-archive with delete calls `delete_worktree` (`useAutoArchiveOnMerge.ts:119-128`).
  - Worktree folder missing > 5 min → record dropped (`projects/storage.rs:124-168`) → next start: orphan index cleanup and orphan session-data cleanup delete its history (`chat/storage.rs:550-650`), **even with retention 0**. Same for `remove_project`.
  - Orphan cleanup skips an index it cannot parse, so its sessions count as orphans and are deleted (`storage.rs:560-569`).
  - `archive_session` deletes instead of archiving when the session looks empty, including on a load error (`unwrap_or_default`, `chat/commands.rs:2085-2125`) and for every terminal session.
  - Capped by design (keep): AI checkpoints 100 per worktree, activity feed 500 events, recovery files 7 days, run input files after each run.
- Terminal sessions have no Jean copy (scrollback not stored); their history is the CLI's own store. Plan files are read from `~/.claude/plans/*.md` (`chat/commands.rs:7023-7030`); the plan text is probably also in the run log as the ExitPlanMode tool input (unverified).
- No user doc says "7 days"; the claim lives only in the research note.

### B2. Definition to publish

> Splitkick never deletes a chat session, its messages, tool output, pasted files or saved contexts on its own. Archiving is a soft delete you can undo. Data is removed only when you choose a permanent delete (delete archived item, delete all archives, clear history, remove project + confirm). If an agent CLI has deleted its own transcript (Claude Code and Gemini CLI do after 30 days), Splitkick replays its own copy of the conversation to the agent. Exceptions: terminal sessions (history belongs to the CLI), AI checkpoints (newest 100 per worktree).

### B3. Changes (land in JeanZ first, see M1)

1. Defaults: `archive_retention_days` 0 (Rust + TS + both `??` fallbacks); `removal_behavior` `"archive"`; plan handoff archives the original (take upstream `bf10f321` or the same change).
2. Missing worktree folder: mark the worktree archived (soft) instead of dropping the record. Never delete session data because a folder vanished.
3. Orphan cleanups (index, data, combined contexts, git-context): when retention is 0, move to `<data>/trash/<YYYY-MM-DD>/` instead of `remove_dir_all`; abort the data cleanup if any index fails to parse. Trash is never emptied automatically (a "Empty trash" button in Settings is enough).
4. `archive_session`: on a load error archive, never delete; terminal sessions archive like others.
5. Resume fallback: when the native target is gone (Claude transcript missing, Codex resume error, OpenCode/Cursor/Pi not-found), clear the resume id and use the existing handoff replay (`resolve_handoff_kind`, `build_handoff_history_text` in `handoff.rs`, up to 40 runs / 60k chars). This is the "durable own store" mitigation; no new store is needed. Also check the native-fork path (`commands.rs:3670-3672`) for a missing transcript.
6. Plan files: when ExitPlanMode is seen, also store the plan text in the session dir (only if B1's unverified point turns out false).
7. Tests: Rust unit tests for each path (retention 0 + missing folder + corrupt index → nothing deleted, items in trash); resume-fallback test with a fake missing transcript.
8. Docs: user guide page "What Splitkick keeps" (B2 text); fix features doc wording (`SessionMetadata.messages` → run logs) — features doc is in the vault, Andreas or the website session updates it.

---

## Part C — Upstream relationship

- Upstream `coollabsio/jean` is at v1.0.11 (`upstream/main` = `bf10f321`). Fork base: v0.1.73; review baseline `docs/upstream/last-sync.json` = `41390c61`. The 1.0.1 merge (`1cf20d58`) was reverted in `54d762af` (z.14) because remote-host ids broke. 189 fork-only commits; 391+ upstream commits pending, 73 high-risk.
- **Rename does not merge anything.** Splitkick 1.0.0 stays on the 0.1.73 base.
- **Merge strategy (proposal, not now):**
  1. Keep `/upstream-review` (an agent review, see `docs/developer/upstream-sync.md`) as the intake. Take fixes by **cherry-pick** in small batches (data-loss and security fixes first, e.g. `bf10f321`), each released normally.
  2. A full base move to upstream 1.x happens on a branch `upstream-1.x`, never directly on `main`: merge, re-run `check:branding`, resolve the brand files listed in A2, then run the M-matrix below **plus remote hosts** (the failure that forced the revert). Ship as `rc` to a test feed only; `main` takes it after one week of daily use.
  3. Before any base move that changes the data format: one-way migration with an automatic backup copy (the updater cannot downgrade; lesson from z.14).
  4. Because Splitkick has its own version line, a base move is a minor/major Splitkick release with "Built on Jean 1.x" in About; no version jump problems.
- **Keep the fork network** (A4) so upstream PRs can be opened from `azeitler/splitkick`.

## Part D — Upstream PR candidates (titles only; Andreas opens the PRs)

Check each against the latest upstream review first; some may be fixed upstream (e.g. #795/`bf10f321`).

**Session status and Claude resume id**

- fix(chat): keep the Claude resume id when a turn is cancelled before output — `34c282ac`
- fix(chat): name the Claude session on every turn so a cancel cannot lose it — `a025ebef`
- fix(chat): stop sessions sticking in "Waiting" and let a manual status win — `8e6cf0c5`
- fix(chat): send a Claude question answer when its turn has ended — `bebd64b4`
- fix(chat): keep a question's options and confirm before clearing context — `c4fa75bf`
- fix(chat): restore a cancelled prompt to the input when the turn is discarded — `dcc150b5`
- fix(chat): report a failed pin or star instead of dropping it — `394318e1`

**Forks and worktrees**

- fix(chat): fork a session while its turn is still running — `d4c1d2bd`
- fix(fork): consume the fork marker when the first turn finishes — `fd456552`
- fix(fork): recompute the message count of a worktree fork — `3a9cde17`
- fix(worktrees): stop new worktrees from vanishing and start them from the right base — `a5562d8e`

**File links**

- fix(chat): resolve a file reference against the session, not a guess — `4130f660`
- fix(chat): resolve ../ file references, including from a subfolder — `efecce71`
- fix(chat): resolve ~/ file references to the home directory — `396353a3`
- fix(chat): keep a path intact, and show it as it was written — `4dd9d74d`
- fix(chat): link a web URL written in backticks — `ec084ca7`
- fix(markdown): keep Windows backslash paths in links and images — `09f35181`
- fix(mcp): strip the verbatim prefix from open_in_browser paths — `ddd5a802`
- fix(files): open a path through the silent shell-association helper — `b0433391`

**Mobile and web**

- fix(mobile): make the phone layout usable — `6697f6f3`
- fix(web): reconnect in place instead of reloading the page — `483fb431`

**Performance and remote**

- perf(sessions): reuse parsed session entries and skip no-op status writes — `f21b6a3a`
- perf(sessions): refresh one worktree, not every session list — `658e7a96`
- fix(remote): keep large remote hosts responsive and stop reading failed checks as empty — `4c6faa85`
- fix(remote): stop reading a TLS redirect as an SSO login proxy — `0563ef68`

**Other**

- fix(usage): stop refreshing the Claude OAuth token from Jean — `ae8cb881`
- fix(usage): read the Claude keychain item Claude Code actually uses — `522cecdf`
- fix(canvas): do not wait forever on a failed preferences load — `a988927f`
- fix(restore): write the pending UI state before the window is destroyed — `eb2704b0`
- fix(data): keep the development build out of the installed app's data — `22a7afe9`
- New from this plan: the B3 retention fixes (orphan cleanup, archive-on-load-error, resume fallback) are generic and good PR candidates too.

---

## Milestones (each ends with a verification step)

**M0 — Decisions (Andreas).** Confirm the open decisions below. Verify: this doc updated, decisions marked.

**M1 — Retention fixes in JeanZ (`0.1.73-z.26`, no rename yet).** Part B3. Ships value now and makes the import safe.
Verify: `bun run check:all`, `cargo test` for the new tests; manual: set retention 0, archive a session, move a worktree folder away, restart twice → session still listed (archived), data in place or in `trash/`; delete a Claude transcript in `~/.claude/projects/…` → next turn in that session remembers earlier facts (handoff replay).

**M2 — Internal Splitkick build (brand core).** A1, A2 (brand.rs, overlay, data dir, MCP name, port, codex socket, `splitkick.json`, icons, strings sweep, `check:branding`, NOTICE/README). Local ad-hoc build via `scripts/build-fork-macos.sh` (renamed output).
Verify: build succeeds; install `/Applications/Splitkick.app` next to Jean and JeanZ; start all three; `~/Library/Application Support/app.splitkick.desktop` is created and `com.jean.desktop` is unchanged (`find … -newer <marker>` returns nothing from Splitkick); `~/.claude.json` has both `jean` and `splitkick` entries; a Claude session in Splitkick can call `mcp__splitkick__get_current_context`; Web Access on 3460 and Jean on 3456 at the same time; `bun run check:branding` clean; screenshots of About, title bar, Dock icon, menu.

**M3 — Import flow.** A3. Fixture: copy of the real `~/Library/Application Support/com.jean.desktop` into `./tmp/jean-fixture` (gitignored), point the detector at it with `JEAN_DATA_DIR`.
Verify: `shasum -r` manifest of the fixture before and after import is identical; projects, sessions, stars/pins, labels appear; pasted images render (path rewrite); saved contexts open; resuming an imported Claude session continues the conversation (worktree in place); new worktree lands in `~/splitkick/<project>/`; remote hosts appear (WebKit copy); preferences show port 3460, retention 0, removal "archive"; then run Jean and Splitkick side by side for a day with Jean still on its own data.

**M4 — Release pipeline.** A4 (Planetfall signing, notarization, new minisign key, versioned DMG, `splitkick-v` tags, `release.yml` guard). Andreas adds the secrets. Use a test feed: release `1.0.0-rc.1` and `1.0.0-rc.2` as GitHub pre-releases plus a local `latest.json` served from `./tmp` (dev builds read the endpoint from `tauri.conf.dev.json`; unverified whether a runtime override exists, add one only if needed).
Verify: `spctl -a -vv /Applications/Splitkick.app` says "Notarized Developer ID", `xcrun stapler validate` on the DMG; install rc.1, update to rc.2 in-app; a JeanZ-key-signed archive is rejected.

**M5 — Bridge and rename.** A5: ship JeanZ `0.1.73-z.26` with the final feed and notice; wait until known JeanZ installs updated; then Andreas renames the repo; update URLs in the code (already pointing to `azeitler/splitkick` from M2).
Verify: z.25 → z.26 update works; z.26 offers no further update; `curl -I` on old `azeitler/jean` repo, release and `releases/latest/download/latest.json` URLs shows redirects; `git fetch` works on the old remote URL.

**M6 — Device check and soak.** Splitkick rc as Andreas' daily driver for one week, Jean still installed.
Verify: Web Access from the phone (Tailscale address, port 3460, token login, phone layout, add to home screen); one remote host session; no data written to `com.jean.desktop` (repeat the `-newer` check).

**M7 — Public launch.** Release `splitkick-v1.0.0` as latest; README/NOTICE final; website points to the DMG URL; Andreas sends the message to Andras Bacsai and opens the part D PRs.
Verify: download DMG from the website on a clean user account, install next to Jean, import, update check returns "up to date".

---

## Open decisions for Andreas (recommendation first)

1. Repo: rename `azeitler/jean` → `azeitler/splitkick`, keep fork network (recommended) / transfer to a Planetfall org / new detached repo.
2. Version: `1.0.0` + semver, tags `splitkick-v*` (recommended) / keep `<base>-z.N`.
3. DMG: versioned `Splitkick-<v>-aarch64.dmg` **plus** constant `Splitkick-aarch64.dmg` for the site (recommended) / versioned only.
4. Web Access default port 3460 (any free port is fine).
5. JeanZ users: bridge release z.26, no auto-migration (recommended).
6. Import option (c) (shared dir) not offered in the UI (recommended).
7. Retention fixes ship in JeanZ z.26 first (recommended) / only in Splitkick.

## Unverified items (collected)

- `mainBinaryName` with the MCP stdio shim (executable path is written into CLI configs).
- Whether `releases/latest/download/…` follows a repo-rename redirect.
- Which certificate the current JeanZ CI secrets hold.
- Live-instance detection through `jean-mcp.sock`.
- Copied WebKit localStorage opens under the new bundle id (likely, `flavor_seed.rs` does it today).
- Plan text present in run logs (ExitPlanMode input).
- Compatibility of 0.1.73-based code with a data dir written by upstream 1.0.x, and of Splitkick desktop with upstream 1.0.x `jean-server` hosts.
- Whether coolLabs is fine with Splitkick reading their model catalog CDN.
- Parallel writes to `~/Library/Caches/jean/usage-cache`.

## Out of scope

Website, docs portal, domains, headless server rebrand, Linux/Windows builds.

## Sources

- GitHub, renaming a repository (redirects; Actions not redirected; name reuse breaks redirects): https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository
- GitHub, detaching a fork (public, < 1 GB, no child forks; permanent; issues not kept): https://docs.github.com/en/pull-requests/how-tos/work-with-forks/detaching-a-fork
- Retention facts: `makerstuff/splitkick/research/retention-2026-10.md`

## Implementation notes (deviations from the plan)

- **Skills dir stays `~/.jean/skills`.** It is a hidden mirror of the
  opinionated skills that both apps install identically; sharing it is
  harmless, and a rename would need a fallback read in four places.
- **`package.json` `name`/`author` stay upstream's.** Internal, never shown.
- **Developer ID:** the current CI certificate is "Developer ID Application:
  Andreas Zeitler (44S2FAD7EU)" (personal, not coolLabs, not a Planetfall
  organisation certificate). It is set through CI secrets; no code change.
- **No `public/manifest.webmanifest` exists** in this tree; nothing to rewrite.
- **Updater key:** generated 2026-10-14 in `.local-signing/splitkick-updater.key`
  (+ `.password`, `.pub`) of the main checkout. Copy it to 1Password and set
  the CI secrets before the first release.

## Status (2026-10-16)

**Released.** Splitkick 1.0.0 is the latest release on `azeitler/splitkick`
(notarized, in-app updates), after the pre-releases 1.0.0-rc.1 to rc.3. JeanZ
ended with 0.1.73-z.26, which reads the fixed `jeanz-final` feed.

| Milestone            | State                                                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| M0 decisions         | Done (all recommendations accepted)                                                                                           |
| M1 retention         | Done, plus `d44484f5` (auto-archived worktrees are never deleted). Resume replay only for Claude                              |
| M2 brand core        | Done                                                                                                                          |
| M3 import            | Done: one chain JeanZ → Jean, incl. window state, WebKit store, cookies, macOS defaults. Used for Andreas' own switch to rc.2 |
| M4 release pipeline  | Done: semver, `splitkick-v*` tags, notarization fixed (stale `APPLE_ID`/`APPLE_PASSWORD` secrets)                             |
| M5 bridge and rename | Done: z.26 shipped, `jeanz-final` feed, repo renamed; old URLs redirect (checked)                                             |
| M6 device check      | Done: daily use, in-app update rc.3 → 1.0.0 works, phone Web Access works (Andreas, 2026-10-16)                               |
| M7 launch            | Release done. Website and docs updated locally (not pushed). Message to coolLabs and upstream PRs open                        |

Resolved items from the unverified list: `mainBinaryName` works (the app runs
as `Splitkick`); the GitHub rename redirects `releases/latest/download/…`; the
CI certificate is "Developer ID Application: Andreas Zeitler (44S2FAD7EU)".

## Left to do

**Andreas (outward steps):**

Done: in-app update, phone Web Access, updater key in 1Password, message to
Andras Bacsai (coolLabs) sent 2026-10-16, roadmap change pushed and deployed.
The upstream relationship and the part D PRs are Andreas's from here on.

1. Optional: delete the 1.0.0-rc.1 pre-release (signed, not notarized).

**Code (next releases):**

- Resume replay when Codex, OpenCode, Cursor or Pi lose their native session
  (B3.5 covers Claude only).
- Store plan text in the session if the run log turns out not to carry it (B3.6).
- User guide page "What Splitkick keeps" (B2 text) on docs.splitkick.app.
- Update the website for each release: `DOWNLOAD_URL`, size and sha256 in
  `splitkick-website/src/site.ts` (versioned DMG on purpose).
- `.local-signing/push-secrets.sh` and `validate.sh` still use the JeanZ names.
- Upstream base move (part C) when wanted: `/upstream-review`, then a
  `upstream-1.x` branch with the full M-matrix incl. remote hosts.
