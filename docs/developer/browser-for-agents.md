# Browser for agents (#104)

Settings → **Web Browser** → **Browser for agents** picks which browser MCP server
Splitkick writes into the CLI backends. User guide:
`docs/userguide/browser-for-agents.md`. Agent Browser details:
`docs/developer/server-agent-browser.md`.

## Engines

`AppPreferences.browser_engine` (`BrowserEngine` in
`jean-core/src/agent_browser/playwright.rs`, serde snake_case, default
`agent_browser`, unknown values fall back to `agent_browser`):

| Value                  | Server key      | Entry                                                                                    |
| ---------------------- | --------------- | ---------------------------------------------------------------------------------------- |
| `off`                  | —               | removes the Splitkick entries                                                            |
| `agent_browser`        | `agent-browser` | `agent-browser mcp`, `AGENT_BROWSER_PROFILE` (written only when the binary is installed) |
| `playwright`           | `playwright`    | `<splitkick> --splitkick-browser-mcp`                                                    |
| `playwright_extension` | `playwright`    | `<splitkick> --splitkick-browser-mcp --extension`                                        |

`set_browser_engine` writes the preference and the entry for each backend
through `agent_browser/config.rs` (`backend_config`, `list_servers`,
`edit_servers`): one edit per file, timestamped backup, no write when nothing
changed. The other engine's Splitkick entry is removed in the same edit.

## The token never leaves Splitkick's process tree

`@playwright/mcp` reads the extension token only from
`PLAYWRIGHT_MCP_EXTENSION_TOKEN` in its environment (no flag;
[cdpRelay.ts](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/tools/mcp/cdpRelay.ts),
[extension README](https://github.com/microsoft/playwright/blob/main/packages/extension/README.md)).

The backend configs do not start `@playwright/mcp`. They start Splitkick's
own binary in **launcher mode** (`LAUNCHER_ARG = --splitkick-browser-mcp`,
handled first in `jean_core::run_server`; `src-tauri` lists it in
`should_run_server`). The launcher (`run_launcher_from_args`):

1. reads `SPLITKICK_BROWSER_DATA_DIR` (non-secret, from the entry) to find the
   Keychain account and the managed install,
2. reads the token from the Keychain (`SecretStore`, service _Splitkick
   Playwright extension token_, account `<data dir>/playwright-extension`),
3. `exec`s `node <managed>/@playwright/mcp/cli.js` or `npx -y
@playwright/mcp@latest` with the passed-through args and the token in the
   child's **environment**. `SPLITKICK_BROWSER_NODE` (absolute `node` found
   when the entry was written) goes first on `PATH`.

Why a launcher and not env on the CLI process:

- Codex clears the env of MCP servers and passes only a fixed list plus
  `env_vars` ([Codex MCP docs](https://learn.chatgpt.com/docs/extend/mcp?surface=cli),
  `codex-rs/rmcp-client/src/utils.rs`). Claude, Cursor, Grok, Kimi and
  Antigravity do not document whether stdio servers inherit the CLI's env.
- The token would otherwise sit in a config file (`env` block) or in the
  per-run MCP config of every Claude run.
- It also works for CLIs the user starts in a terminal.

So the entry holds no secret and #102's per-run file
(`chat/run_secrets.rs`, `docs/developer/process-secrets.md`) has nothing to
carry for this server. Tests: `token_never_lands_in_a_config_file_or_entry`,
`connection_test_passes_the_token_in_env_not_args`,
`server_command_never_carries_a_token_argument`.

Keychain items are per data dir, so the installed app, the dev build and an
isolated `SPLITKICK_DATA_DIR` never share one. `SPLITKICK_REMOTE_TOKEN_STORE=file`
(sealed test runs, non-macOS) keeps tokens in `<data>/browser-tokens.json`
(`0600`) instead. `SecretStore` (`jean-core/src/secret_store.rs`) is shared
with the remote connection tokens of #94.

## Hand-made Playwright servers

`is_hand_made_playwright`: a server named `playwright`, or any server whose
command/args mention `@playwright/mcp` / `playwright-mcp`, that is not ours
(ours has `--splitkick-browser-mcp` in its args). With a Playwright engine,
such a server makes that backend `conflict` and nothing is added (no
duplicate). `takeOver: true` removes them and writes ours; the backup keeps the
user's entry. `get_browser_engine_status.handMade` lists them for the UI.

## Commands and Web Access

| Command                        | Where                               | Notes                                                                                    |
| ------------------------------ | ----------------------------------- | ---------------------------------------------------------------------------------------- |
| `get_browser_engine_status`    | `dispatch.rs`                       | engine, `hasToken`, install, hand-made list; never the token                             |
| `set_browser_engine`           | desktop IPC (`desktop_commands.rs`) | `engine`, `backends?`, `takeOver?`                                                       |
| `save_browser_extension_token` | desktop IPC                         | empty token removes it; returns `hasToken`                                               |
| `test_browser_connection`      | desktop IPC                         | starts the server, `initialize` + `tools/call browser_tabs {action: list}`, 45 s timeout |
| `install_playwright_mcp`       | desktop IPC                         | `npm install --prefix <data>/playwright-mcp-cli @playwright/mcp`                         |

The four write commands are deliberately **not** in the WebSocket dispatch and
are listed in `DESKTOP_ONLY_COMMANDS` (`src/lib/transport.ts`): Web Access and
remote connection windows show the setting read-only
(`BrowserForAgentsSection`, `isLocalBackend()`), and no token can be sent to or
read from a web client.
