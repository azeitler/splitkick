# Splitkick links and `@` mentions

`splitkick://<kind>/<id>` names one object of the instance that wrote it (#44).
Chat renders it as a link with an icon and the resolved name; the model resolves
it with the Splitkick MCP tools.

| Kind         | Id from                                   | MCP tool to resolve it                   | Click opens                 |
| ------------ | ----------------------------------------- | ---------------------------------------- | --------------------------- |
| `session`    | session id                                | `read_session_messages` (`sessionId`)    | the session modal           |
| `worktree`   | worktree id                               | `get_worktree` (`worktreeId`)            | the worktree                |
| `project`    | project id                                | `get_project_context` (`projectId`)      | the project canvas          |
| `agent`      | agent id (`agents.json`)                  | `send_to_agent` (`agent`), `list_agents` | the agent's current session |
| `connection` | connection id (`remote-connections.json`) | `remote_tool` (`instance`)               | the connection window       |

## Where a kind is registered

A new kind needs all of these:

1. `jean-core/src/links.rs`: `resolve_splitkick_link` arm and a test. A
   connection resolves through `remote_instances::find_remote_connection`,
   which reads no token (no Keychain access per rendered link).
2. `src/lib/splitkick-links.ts`: `SplitkickLinkKind`, `LINK_RE` and
   `openSplitkickLink`.
3. `src/components/chat/splitkick-link-icons.ts`: one icon, shared by the chat
   link and the `@` picker.
4. `jean-core/src/jean_mcp_core.rs`: one line in `JEAN_MCP_INSTRUCTIONS`
   (kind → tool), checked by `initialize_advertises_instructions_and_prompts`.

## The `@` picker

`FileMentionPopover` shows files (unchanged: scopes, `PendingFile`) plus the
object groups from `useMentionObjects`. Ranking and search are pure functions in
`src/components/chat/mention-objects.ts`:

- Sources are lists other views already cache: `list_all_sessions`,
  `list_projects`, `list_agents`, `list_remote_connections`. Nothing loads while
  the picker is closed. Fuse indexes are built when a list changes, not per key.
- `likely` = in the current project (global agents and connections always). It
  sorts first while browsing and wins over a slightly better text match
  (`LIKELY_BONUS`). Recency breaks ties.
- Groups: Files first while browsing or for a path-like query (`/`, `.`);
  otherwise ordered by their best match score.
- 5 rows per object group while browsing, 8 with a query, 15 files.

`ChatInput.handleObjectSelect` replaces `@query` with
`[name](splitkick://kind/id) `. The composer is a plain textarea, so the
mention stays markdown text (no chip).

Connections come from the backend, not from the client's own list: those are
the ids that `list_instances`/`remote_tool` accept. In Web Access that is the
server's list. A click on a connection link opens it only when this client has
the same id saved (`getRemoteConnections()`); otherwise a toast points to
Server connections.
