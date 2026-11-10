# Several Claude accounts (#90, proof of concept; global switch #131)

## Claude CLI behaviour (verified 2026-11-06, Claude Code 2.1.277, macOS)

Sources: the Claude Code authentication docs
(https://code.claude.com/docs/en/authentication), the community notes in
https://gist.github.com/KMJ-007/0979814968722051620461ab2aa01bf2, and the CLI
binary itself (`~/.local/share/claude/versions/2.1.277`). The official docs do
not describe the Keychain name; the binary is the source for that.

- **Logins are isolated per config folder.** `CLAUDE_CONFIG_DIR=<dir> claude
auth status` in a new, empty folder reports `loggedIn: false`,
  `configDirectory: <dir>`, `projectsDirectory: <dir>/projects`, while the
  root install stays logged in. The design depends on this.
- **Keychain service name (macOS).** Function `SO()` in the CLI:
  - `CLAUDE_CONFIG_DIR` unset → `Claude Code-credentials` (the root install).
  - set → `Claude Code-credentials-` + the first 8 hex chars of
    `sha256(CLAUDE_CONFIG_DIR.normalize("NFC"))`. The input is the **raw env
    string** (`process.env.CLAUDE_CONFIG_DIR`); no `~` expansion, no path
    resolution, no trailing-slash trim.
  - So `CLAUDE_CONFIG_DIR=~/.claude` (expanded) is a **different login** from
    the root install, and `/x/acc` and `/x/acc/` are two different logins.
    Jean normalizes the folder once on save and passes that exact string
    everywhere; the root install never gets the variable.
  - The account in the item is the macOS user name. The suffix can be checked
    without reading the secret: `security find-generic-password -s
"Claude Code-credentials-<hash>"` (no `-w`).
- **Files.** With `CLAUDE_CONFIG_DIR` set, the global config with
  `oauthAccount` is `<dir>/.claude.json` (created on the first run) and the
  file credentials are `<dir>/.credentials.json` (Linux, Windows, macOS
  fallback). The root install uses `~/.claude.json` and
  `~/.claude/.credentials.json`.
- **Login for another folder.** `claude auth login` (subcommands `login`,
  `logout`, `status`) honours `CLAUDE_CONFIG_DIR` from the process env. Jean
  runs `env CLAUDE_CONFIG_DIR=<dir> <claude> auth login` in its login terminal.
- **Resume is per folder.** `CLAUDE_CONFIG_DIR=<empty dir> claude -p --resume
<id of a root-install session>` fails with `No conversation found with
session ID: <id>`. Transcripts live in `<dir>/projects/<cwd>/<id>.jsonl`.

- **End to end with a real second login** (2026-11-06, a different account
  from the root install): `claude auth login` with `CLAUDE_CONFIG_DIR` set
  created the Keychain item with exactly the computed suffix; Splitkick's usage
  code read that item and got the account's own limits and email
  (`reports_real_usage_of_an_extra_account`, ignored test); a `-p` run wrote its
  transcript only into `<dir>/projects`, and `--resume` worked there.
- **Resume across folders works once the file is copied** (2026-11-10,
  Claude Code 2.1.277, throwaway folders A and B, a local fake API via
  `ANTHROPIC_BASE_URL`, no real account). A turn under A wrote
  `A/projects/<slug>/<id>.jsonl`. `CLAUDE_CONFIG_DIR=B claude -p --resume <id>`
  failed with `No conversation found`. After `cp` of the file into
  `B/projects/<slug>/`, the same command continued: the request carried the
  first turn's text, and Claude appended to B's copy; A's stayed unchanged.
  Docs: `CLAUDE_CONFIG_DIR` moves settings, history and login
  (https://code.claude.com/docs/en/env-vars,
  https://code.claude.com/docs/en/authentication); transcripts are
  `projects/<cwd slug>/<id>.jsonl` with `<id>/subagents/` and
  `<id>/tool-results/` next to them
  (https://code.claude.com/docs/en/claude-directory,
  https://code.claude.com/docs/en/sessions).

## Design

- **Preferences** (snake_case, `#[serde(default)]`): `claude_root_label`,
  `claude_accounts: [{id, label, config_dir}]`, `claude_active_account`
  (`null` = root). `save_preferences` runs `claude_cli::normalize_accounts`:
  expands `~`, drops trailing slashes, drops relative, duplicate and
  `~/.claude` folders, creates missing folders, and resets an active id that
  is gone.
- **One module**: `jean-core/src/claude_cli/accounts.rs`. `ResolvedClaudeAccount`
  carries `config_dir: Option<String>` (`None` = root) and `apply_env()`, which
  sets `CLAUDE_CONFIG_DIR` only for a non-root account. Unknown ids resolve to
  the root install.
- **Process env everywhere.** `--settings` env does not switch the login, so
  every Claude process gets the variable in its process env:
  - chat: `build_claude_args` adds it to the detached spawn env (Unix `sh`
    prefix, WSL script, native Windows `cmd.env`), and `--add-dir` uses the
    account's `skills/` and `commands/`;
  - one-shots (naming, context summary, PR, commit, review, release notes,
    checkpoint restore), `claude auth status`, `claude mcp list`, plugin
    install: the **active** account;
  - login: the frontend's `claudeLoginCommand()` (`src/lib/claude-accounts.ts`).
- **One global switch (#131).** Every Claude run uses the active account
  (`accounts::active_account`): new, open and old sessions, resume, forks,
  moves, one-shots, the auth check and login. Make active (Settings, usage
  popover, menu bar) takes effect on the next send of every session; a running
  turn finishes on its account. (#90 bound a session to the account of its
  first run; that was wrong and is gone.)
  - `Session`/`SessionMetadata.claude_account_id` is a **record** of the
    account of the last run, written at each send. It never chooses. Crash
    recovery (`resume_session`) tails a still-running turn with it. The limit
    banner names it ("Vu3D: Session limit hit"). Fork and move copy it;
    transfer clears it (ids are machine-local).
  - **Transcript copy before resume.** `send_chat_message` calls
    `claude::sync_transcript_to_active_account` when the session has a
    `claude_session_id`: it finds the newest `<id>.jsonl` in every configured
    account folder (plus a profile's `CLAUDE_CONFIG_DIR`) and copies it, with
    its `<id>/` folder (subagents, tool results), into the active account's
    `projects/` when the copy there is missing or older. It overwrites the
    target's own copy in place (a second slug would make `--resume` report
    "not found"), writes through a temp file, and never moves or deletes a
    source. Folders whose `projects/` resolves to the target's (a symlink, as
    on mb14) are skipped. With no transcript anywhere, the existing
    lost-context handoff replays Jean's history.
  - Transcript lookups (`claude_transcript_exists`/`_count`, the blocking-tool
    flush wait) search only the active account's folder for a non-root
    account.
  - Prompt cache is per account: the first turn after a switch costs more.
- **Usage per account.** `get_claude_usage(accountId?)` (`None` = root),
  `get_claude_accounts_usage` (all, root first; used by MCP `get_usage` as
  `claude_accounts`). MCP `get_usage`'s top-level `claude` is the active
  account. The titlebar badge (`useUsageBadge`) and the model chip show the
  active account for Claude sessions. Keychain service, `.credentials.json`, `.claude.json`
  email and the 5-minute cache file (`claude-<hash>.json`) are per folder. The
  frontend has one TanStack query per account (`accountUsage(id)`) with the
  `usage-timing.ts` rules; the background refresh walks the accounts one by
  one through their caches, so there is no request storm.

## Limits of the proof of concept

- No per-session or per-project account choice.
- Login for a non-root account uses `env`, so it is not offered on native
  Windows; WSL mode supports the root install only.
- Jean's MCP server list (Settings, chat toggles) still reads the root
  install's `~/.claude.json`. Claude itself loads the account's own servers.
- Claude NFC-normalizes the folder before hashing; Jean hashes the bytes as
  they are. Same result for ASCII paths.
- "Resume in terminal" (`claude --resume <id>`) and the native CLI session list
  still use the root install.
- Removing an account keeps its folder and Keychain item. Its transcripts are
  no longer searched, so a session whose newest transcript lived only there
  gets Jean's history replayed (lost-context handoff).
