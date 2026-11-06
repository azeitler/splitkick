# Remote MCP: agents on other Splitkick instances

Issue #94. An agent in a session on one machine can act on another Splitkick
instance the user connected, for example "send a message to project X on
mb16". Code: `jean-core/src/remote_instances.rs`.

## The parts

| Part                 | Where                                                    |
| -------------------- | -------------------------------------------------------- |
| Connection store     | `remote_instances.rs` (`list_/save_/remove_/import_…`)   |
| MCP tools            | `list_instances`, `remote_tool` in `jean_mcp_core.rs`    |
| Route on each server | `POST /api/mcp/call` in `http_server/server.rs`          |
| Desktop token read   | `get_remote_connection_secrets` in `desktop_commands.rs` |
| Frontend             | `src/lib/remote-connections.ts`                          |

## Connections and tokens

- `remote-connections.json` in the data directory: id, name, URL, SSH user,
  host and port. **No token field.**
- Tokens: on macOS a generic Keychain item, service
  `Splitkick remote connection token`, account `<data dir>/<connection id>`.
  The account carries the data directory, so the installed app, the dev build
  and an isolated profile never share an item. Other platforms, and
  `SPLITKICK_REMOTE_TOKEN_STORE=file`, use `remote-connection-tokens.json`
  (mode `0600`). The sealed e2e instances set the variable so a test run never
  writes to the login Keychain.
- Dispatch commands (native and WebSocket): `list_remote_connections` (no
  token, only `hasToken`), `save_remote_connection` (`token` absent keeps the
  stored token, `""` removes it), `remove_remote_connection`,
  `import_remote_connections` (adds unknown ids only).
- `get_remote_connection_secrets` returns the tokens. It is a desktop-only
  Tauri command and **not** in `dispatch.rs`, so Web Access answers
  "Unknown command". Never add it there.

### Frontend

The desktop shell calls `hydrateRemoteConnections()` in `src/main.tsx` before
the first render: the transport and connection windows read the active
connection synchronously, so the list (with tokens) has to be in memory first.
Tokens stay in memory; nothing goes to localStorage.

Migration: at the first start a list left in localStorage
(`jean-remote-connections`) goes to `import_remote_connections`, then the key is
removed. If the import fails, the old list is used for this run and stays for
the next try.

Web Access keeps its own list in the browser's localStorage, as before. It
never sees the backend's tokens.

All calls go to the desktop shell's own backend through
`@tauri-apps/api/core`, not through `transport.ts`: in a connection window the
transport talks to the remote.

## MCP tools

- `list_instances` → `{ instances: [{ id, name, url, reachable, version,
error? }] }`. Probes `GET /api/version` with a 5 s timeout, all in parallel.
- `remote_tool(instance, tool, arguments)` → the remote's MCP result unchanged,
  with one text block in front that names the instance and
  `_meta.splitkickInstance = { id, name }`. `instance` is a name (case
  insensitive) or id. Rate-limited like the other write tools, on both sides.

The token goes in an `Authorization: Bearer` header, never in the URL, so it
cannot show up in a proxy or server log.

## `POST /api/mcp/call`

Body `{ tool, arguments, origin, hop, depth }`. Same auth as `/api/invoke`.
Answers `{ ok: true, result }` or `{ ok: false, error, code }` (401 bad token,
422 refused or failed).

The caller is an instance, not a local session: the tool runs with source
`remote:<origin>` (only `[A-Za-z0-9._-]` kept). Tools that need the calling
session (`get_current_context`, `set_session_status` without `sessionId`) get
the normal "no session context" error.

Refused on the remote side in v1:

- `hop > 1`, `remote_tool` and `list_instances`: one hop only, so no loops.
- Graph writes: `create_node`, `update_node`, `set_node_state`,
  `send_request`, `set_serves`, `create_graph`. Graph reads keep the default
  read permission of a caller without a session.

The remote must have the Splitkick MCP server on (`jean_mcp_enabled`); its
error passes through.

## Errors the agent sees

| Case                  | Message starts with / contains                    |
| --------------------- | ------------------------------------------------- |
| Unknown instance      | `Unknown Splitkick instance '<x>'` + known names  |
| Unreachable           | `… is unreachable at <url>: …`                    |
| Bad token (401)       | `… rejected the access token`                     |
| Old version (404/405) | `… is too old for remote MCP calls`               |
| Login proxy (HTML)    | `… without a valid response`                      |
| Remote tool error     | `[<instance name>] <remote message>`, remote code |

## Tests

- Rust: `remote_instances::tests` — store without tokens on disk, `0600`
  token file, import, URL checks, error mapping, loop guard and refusals, and
  `remote_tool_forwards_between_two_instances` (two real servers). The
  Keychain round trip is `#[ignore]`; run it by hand:
  `cargo test --lib keychain_roundtrip -- --ignored`.
- TS: `src/lib/remote-connections.test.ts` (migration, desktop writes),
  `RemoteConnectionsDialog.test.tsx` (failed save and delete).
- E2E: `e2e/local/tests/remote-mcp.spec.ts` — A's agent lists B, creates a
  session on B, sends to it and reads the stub's reply; B's UI shows it.
