# Secrets never go into process arguments

Every local process of the user can read the command line of every other
process (`ps -axo args`; on Linux `/proc/<pid>/cmdline` is readable by all
users). Debug logs also print command lines. So a token, API key or
`Authorization` header must **never** be part of the argv of a process that
Splitkick starts (#102). This includes:

- inline JSON flags (`claude --mcp-config '{…}'`, `--settings '{…}'`),
- config overrides (`codex -c key=value`),
- `sh -c "<script>"` strings — the script *is* an argument, so
  `sh -c "KEY=secret cli …"` leaks `secret`,
- `env KEY=secret cli …` and `--token secret`.

## Where secrets go instead

| Channel | Use it for | Helper |
|---|---|---|
| Child environment | Env vars of the CLI itself (profile env, account dir) | `Command::env` / `.envs()`; for the detached `sh -c` spawn, set them on the `sh` command so the child inherits them (`chat/detached.rs`) |
| stdin | Scripts that need values (WSL launcher) | `build_wsl_claude_script` exports env in the stdin-fed launcher, not in the inner `sh -c` |
| Private file (0600) | Config blobs that contain secrets (MCP configs) | `chat/run_secrets.rs` |

## Per-run MCP config files

`crate::chat::run_secrets::write_run_mcp_config(app_data_dir, session_id, json)`
writes the run's MCP config to `<app data>/run-secrets/<session>-<uuid>.mcp.json`
(file 0600, dir 0700) and returns a `RunSecretFile` guard. Pass
`guard.path()` to the CLI and hold the guard until the run ends; dropping it
deletes the file. `cleanup_stale_run_secrets` runs at start-up and removes
files older than a minute (runs Splitkick did not see end). The CLI reads its
config when it starts, so a detached run that outlives Splitkick no longer needs
the file.

Any new MCP server entry that carries a token goes into the config JSON and
through this helper — unless the server can fetch the token itself: the
Playwright browser engine (#104) points the entry at Splitkick's launcher,
which reads the token from the Keychain and passes it to the server's
environment (`docs/developer/browser-for-agents.md`). Use
`write_private_file(path, bytes)` when a file needs a different owner or
lifetime (the Grok ACP host reads and deletes its own `--mcp-servers-file`).

Why a file and not `${VAR}` expansion: Claude Code documents env expansion for
`.mcp.json` ([MCP docs](https://code.claude.com/docs/en/mcp)), not for inline
`--mcp-config` strings, and every env value of every user server would need its
own placeholder. `--mcp-config` accepts file paths
([CLI reference](https://code.claude.com/docs/en/cli-reference), `claude --help`:
"Load MCP servers from JSON files or strings").

## Backend status (audited for #102)

| Backend | How MCP/secrets reach it |
|---|---|
| Claude (chat) | `--mcp-config <private file>`; profile via `--settings <path>`; inline `--settings` JSON holds only `effortLevel`, `alwaysThinkingEnabled`, `fastMode` |
| Claude (one-shot magic prompts) | No MCP config; profile env via `.env()` |
| Codex | MCP servers from `~/.codex/config.toml`; `-c` overrides hold only provider id, name, base URL and the env-key *name* |
| OpenCode | `serve --hostname --port`; MCP from the opencode config file |
| Cursor | MCP config only parsed for server names |
| PI / PI RPC host | Host argv holds paths and PI flags; provider keys by env-var *name* |
| Grok | ACP host gets `--mcp-servers-file <0600 file>`, sends `mcpServers` over stdin JSON-RPC, deletes the file |
| Kimi, Antigravity, Command Code | No MCP secrets in argv |

When you add a spawn site, write a test that builds its arguments with a fake
token (`"SECRET-TOKEN-123"`) and asserts the token is in no argument — see
`mcp_secrets_never_appear_in_claude_args` (`chat/claude.rs`) and
`detached_claude_env_reaches_the_child_but_not_any_argv` (`chat/detached.rs`).
