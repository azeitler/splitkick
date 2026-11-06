# Several Claude accounts (#90, proof of concept)

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
- **Sessions record their account.** `Session`/`SessionMetadata.claude_account_id`.
  `send_chat_message` decides with `accounts::session_account_id`: the recorded
  id wins; no record but a `claude_session_id` means a session from before
  accounts → root; else the active account, recorded at once. Transcript
  lookups (`claude_transcript_exists`/`_count`, the blocking-tool flush wait)
  search only the account's folder for a non-root account. Crash recovery
  (`resume_session`) tails with the recorded account.
  - **Fork** and **move** copy the metadata, so the account goes with them
    (`--fork-session` and `--resume` need the source folder).
  - **Transfer** to another machine clears it: ids are machine-local and the
    import is a handoff that needs no transcript.
- **Usage per account.** `get_claude_usage(accountId?)` (`None` = root),
  `get_claude_accounts_usage` (all, root first; used by MCP `get_usage` as
  `claude_accounts`). Keychain service, `.credentials.json`, `.claude.json`
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
- Removing an account keeps its folder and Keychain item. Sessions recorded on
  it fall back to the root install, and Jean replays their history
  (lost-context handoff) because the transcript is not there.
