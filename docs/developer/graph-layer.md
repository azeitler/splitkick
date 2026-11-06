# Graph layer (roadmap above the schedule)

Design: `docs/superpowers/specs/2026-11-02-graph-layer-design.md`. Mockup:
`docs/mockups/graph-layer/`. Issues: #78 (design), #79 (phase 1). This file is the
**contract** between the Rust core, the MCP tools and the React UI. Change it first
when the contract changes.

## Concepts

- **Graph** = one YAML file at a path the user chooses (inside a project's repo,
  in another repo, or in a folder outside any repo). Splitkick keeps a **registry**
  of known graph files in app data.
- **Node**: `id`, `title`, `description`, `state`, `properties`, `relations`,
  `attachments`. Derived values (active, blocked, progress, reverse relations) are
  computed, never written.
- **Sessions point up**: `SessionMetadata.serves` lists node refs. The graph never
  lists sessions.
- **Agents**: saved profiles in preferences (`agent_profiles`). A session started
  from an agent stores `agent_id`; its effective graph permission is
  `graph_permission` (`read` | `write` | `manage`).
- **The user** (UI commands) always has `manage`. Every change is in the change
  log (per machine). Agents must give a `why`.

## File format (`serde_yaml`)

```yaml
id: 3f2c9e1a-…            # uuid v4, stable across renames and moves
title: Splitkick roadmap
type: roadmap             # free word
nodes:
  - id: k7m2qd            # 6 chars [a-z0-9], unique in the graph
    title: Graph support v1
    description: |        # optional
      …
    state: committed      # proposed | committed | done | dropped (default proposed)
    properties:           # optional, ordered string map
      quarter: 2027-Q1
    relations:            # optional, ordered, one-key maps
      - depends-on: x91ffa
      - blocked-by: "decision: storage for multi-machine sync"
      - part-of: r00t01
      - relates-to: 8b0d…#a1b2c3
    attachments:          # optional, ordered, one-key maps; unknown kinds kept
      - issue: azeitler/splitkick#78
      - note: Runner stays out of v1.
```

- Unknown top-level and node fields are kept (`#[serde(flatten)]` extra map).
- Writes keep node order and field order; empty optional fields are not written.
- Relation targets: a node id in the same graph, `<graph-id>#<node-id>` for another
  graph, or free text (only for `blocked-by`; any target that is not an existing
  node id and has no `#` is free text).
- Resolving a `blocked-by` decision removes that relation and adds a
  `note: "Decision: <question> → <answer>"` attachment.

## App data (`<app data>/graphs/`)

| File | Content |
| --- | --- |
| `registry.json` | `[{ "id", "path" }]` known graph files (absolute paths) |
| `changes/<graph-id>.jsonl` | change log, one `GraphChange` per line |
| `requests/<graph-id>.json` | `GraphRequest[]` |
| `seen.json` | `{ "<graph-id>": ["<change-id>", …] }` changes the user has seen |

Atomic writes (uuid `.tmp` + rename) under a module lock, as in
`projects/checkpoints.rs`. Graph files are read-modify-written under a per-path
lock and are **re-read from disk before each write**, so an outside edit is never
overwritten. A poller (every 2 s, started on first use of the module) compares
file mtimes and emits `cache:invalidate` with key `graphs` when a file changed
outside Splitkick.

## Rust module

`jean-core/src/graphs/` (`mod.rs` re-exports): `model.rs` (file + API types),
`store.rs` (YAML IO, registry, locks, poller), `derive.rs` (derived values),
`changes.rs` (change log, seen, revert), `requests.rs`, `location.rs` (git/repo
detection, commit), `commands.rs` (UI commands), `permissions.rs`.
Every UI write emits `cache:invalidate` `["graphs"]` (and `["sessions"]` when it
touches session metadata) via `emit_all`.

## API types (camelCase over the wire)

```ts
type NodeState = 'proposed' | 'committed' | 'done' | 'dropped'
type RelationKind = 'depends-on' | 'blocked-by' | 'part-of' | 'relates-to'
type GraphPermission = 'read' | 'write' | 'manage'
type GraphLocationKind = 'project-repo' | 'other-repo' | 'folder'

interface GraphRelation { kind: RelationKind; target: string }
interface GraphAttachment { kind: string; value: string }
interface GraphNode {
  id: string; title: string; description: string; state: NodeState
  properties: [string, string][]; relations: GraphRelation[]; attachments: GraphAttachment[]
}
interface GraphSummary {
  id: string; title: string; graphType: string; path: string
  locationKind: GraphLocationKind; repoRoot: string | null
  projectId: string | null; projectName: string | null
  branch: string | null; defaultBranch: string | null
  offDefaultBranch: boolean        // project-repo whose checkout is not on the default branch
  missing: boolean; error: string | null
  nodeCount: number; unseenChanges: number; openRequests: number
}
interface ServingSession {
  sessionId: string; sessionName: string; projectId: string; worktreeId: string
  worktreeName: string; status: string   // run status label: running | idle | waiting | review | …
  agentId: string | null
}
interface NodeDerived {
  active: boolean; blocked: boolean; blockers: string[]  // human text, e.g. "depends-on Graph layer design"
  progressDone: number; progressTotal: number            // over part-of children (dropped excluded)
  serving: ServingSession[]
}
interface IncomingRelation { kind: RelationKind; source: string; external: boolean }
interface ExternalNodeRef {
  ref: string; graphId: string; graphTitle: string | null; nodeId: string
  title: string | null; state: NodeState | null; found: boolean
}
interface GraphDetail {
  summary: GraphSummary; nodes: GraphNode[]
  derived: Record<string, NodeDerived>         // by node id
  incoming: Record<string, IncomingRelation[]> // by node id, incl. from other registered graphs
  external: Record<string, ExternalNodeRef>    // by ref, for every cross-graph target or source
  graphServing: ServingSession[]               // sessions that serve the whole graph ("<graph-id>")
}
type GraphActor =
  | { kind: 'user' }
  | { kind: 'session'; sessionId: string; sessionName: string; agentId: string | null }
interface GraphChange {
  id: string; graphId: string; nodeId: string | null; at: number   // ms epoch
  actor: GraphActor; action: string   // node.create | node.update | node.state | node.delete | graph.create | graph.update | request.answer | session.serves | revert
  summary: string; why: string | null
  before: GraphNode | null; after: GraphNode | null
  revertedBy: string | null; seen: boolean   // seen: user's own changes are always seen
  serves?: ServesChange                // only session.serves (and its revert)
}
// A manager changed another session's serves (#88): the refs of this graph only.
interface ServesChange {
  sessionId: string; sessionName: string; added: string[]; removed: string[]
}
interface GraphRequest {
  id: string; graphId: string; nodeId: string
  kind: 'accept-done' | 'decision'
  title: string; body: string; evidence: string[]; options: string[]
  blocker: string | null            // decision: the blocked-by text it resolves
  fromSessionId: string | null; fromSessionName: string | null; agentId: string | null
  createdAt: number
  status: 'open' | 'accepted' | 'sent-back' | 'answered'
  answer: string | null; answeredAt: number | null
}
interface GraphLocationInfo {
  path: string; exists: boolean; locationKind: GraphLocationKind; repoRoot: string | null
  branch: string | null; defaultBranch: string | null; projectId: string | null
  projectName: string | null; offDefaultBranch: boolean
}
```

## UI commands (dispatch arms in `http_server/dispatch.rs`; actor = user)

| Command | Args | Returns |
| --- | --- | --- |
| `list_graphs` | — | `GraphSummary[]` |
| `get_graph` | `graphId` | `GraphDetail` |
| `get_graph_location_info` | `path` | `GraphLocationInfo` |
| `create_graph` | `title, graphType, path` (absolute, `.yml`; fails if it exists) | `GraphSummary` |
| `open_graph_file` | `path` (adds an `id` if the file has none) | `GraphSummary` |
| `remove_graph` | `graphId` (unregister only; file stays) | `null` |
| `update_graph` | `graphId, title?, graphType?` | `GraphSummary` |
| `create_graph_node` | `graphId, node: { title, description?, state?, properties?, relations?, attachments? }, why?` | `GraphNode` |
| `update_graph_node` | `graphId, nodeId, patch: { title?, description?, state?, properties?, relations?, attachments? }, why?` (each given list replaces) | `GraphNode` |
| `delete_graph_node` | `graphId, nodeId, why?` (also removes same-graph relations to it) | `null` |
| `list_graph_changes` | `graphId` | `GraphChange[]` newest first |
| `mark_graph_changes_seen` | `graphId, changeIds?` (missing = all) | `null` |
| `revert_graph_change` | `graphId, changeId` (node change: refuses when the node changed after it; `session.serves`: removes what it added, adds back what it removed) | `null` |
| `list_graph_requests` | `graphId?` | `GraphRequest[]` newest first |
| `answer_graph_request` | `graphId, requestId, action: 'accept' \| 'send-back' \| 'answer', answer?` | `GraphRequest` |
| `commit_graph` | `graphId, message?` (stages and commits only this file: `git add -- f` + `git commit --only -- f`) | commit sha |
| `set_session_serves` | `sessionId, serves: string[]` (replaces) | `null` |
| `change_session_serves` | `sessionId, add?: string[], remove?: string[]` (removing a missing ref is a no-op) | `string[]` resulting list |
| `set_session_agent` | `sessionId, agentId: string \| null, permission?: GraphPermission` (≤ profile level) | `null` |
| `set_session_graph_permission` | `sessionId, permission` | `null` |

Answer semantics: `accept` (accept-done) sets the node `done`; `send-back` keeps the
state and adds the answer as a follow-up note in the requesting session
(`edit_session_follow_ups`); `answer` (decision) resolves the blocker (see file
format) and also adds a follow-up note. Every answer is in the change log.

## Session metadata (`chat/types.rs`, `SessionMetadata` and `Session`)

- `serves: Vec<String>` (`#[serde(default, skip_serializing_if = "Vec::is_empty")]`):
  `<graph-id>#<node-id>` or `<graph-id>` (whole graph).
- `agent_id: Option<String>`, `graph_permission: Option<String>`.
- Copied to `Session` in `to_session()`; not synced back in `update_from_session`
  (as `started_by_session_id`). Fork: keep `serves` and `agent_id`, keep
  `graph_permission`. Move: keep.
- Effective permission: `graph_permission`, else the agent's level, else `read`.

## Agent profiles (`AppPreferences.agent_profiles`, snake_case)

```ts
interface AgentProfile {
  id: string; name: string; color: string; persona: string
  permission: GraphPermission
  backend: string | null; model: string | null; default_serves: string | null
}
```

The persona and a short graph context ("This session serves node X in graph Y;
use the Splitkick graph tools; give a why for every change") are added to the
system prompt of every backend through one helper
`graphs::session_prompt_parts(app, session_id) -> Vec<String>`.

## MCP tools (`jean_mcp_core.rs`; actor = calling session `source`)

| Tool | Needs | Notes |
| --- | --- | --- |
| `list_graphs` | read | summaries |
| `read_graph` | read | nodes + derived + open requests; `graphId` |
| `create_node` | write | `graphId, title, description?, state?, partOf?, relations?, attachments?, properties?, why` — state other than `proposed` needs manage |
| `update_node` | write | `graphId, nodeId, title?, description?, setProperties?, removeProperties?, addRelations?, removeRelations?, addAttachments?, removeAttachments?, why` |
| `set_node_state` | write / manage | `proposed` needs write; `committed`, `done`, `dropped` need manage; `why` |
| `send_request` | write | `graphId, nodeId, kind, title, body?, evidence?, options?, blocker?` |
| `set_serves` | read / manage | `serves` (replaces) **or** `add`/`remove` (arrays of refs; removing a missing ref is a no-op), `sessionId?`, `reason?`. Own session (no `sessionId`): any permission, not logged. Another session: manage and `reason`; logs one `session.serves` change per touched graph (actor = caller, `serves.sessionId` = target, `why` = reason), revertable in Review. Added refs are validated, removed ones not. Returns `{ sessionId, serves, refs }` |
| `list_requests` | read | `graphId, status? (open \| answered \| all, default all; answered = accepted, sent-back, answered), mine?, nodeId?` — newest first, with `answer`/`answeredAt`; empty `body`/`options`/`blocker` left out |
| `list_changes` | read | `graphId, nodeId?, limit? (30, max 200), since? (ms), withSnapshots?` — newest first; actor `you` or session name + `agentId`; `revertedBy`, `revertedByUser`, `serves` for `session.serves`; no `before`/`after` unless `withSnapshots`; never changes seen |
| `create_graph` | manage | `title, graphType, why` and either `path` (absolute `.yml`/`.yaml`, `~/` expanded) or `projectId` + `relativePath?` (default `.splitkick/graphs/<slug>.yml`, slug as the UI's `slugify`); logs `graph.create` with the session as actor |
| `create_session` (existing) | — | new optional `serves`, `agentId` (agentId needs manage) |
| `get_current_context` (existing) | — | also `serves` (`{ ref, graphId, graphTitle, nodeId, nodeTitle }`, titles null when gone), `agentId`, `graphPermission` (effective) |

Writes without `why` fail. Writes are rate-limited (`RATE_LIMITED_TOOLS`).
`anon` callers have `read`.

## UI

- Sidebar section **Graphs** between Starred and Folders (sticky slot
  `--sb-graphs-top`, `data-sidebar-graphs`, collapse persisted as
  `graphs_section_collapsed` in UI state). Rows: title, `type · where`, counts.
- Per-project **Graphs** row in the sidebar tree, beside Pinned (#99,
  `ProjectGraphsSection`): graphs stored in the project, then graphs from
  elsewhere that a live session of the project serves (`selectProjectGraphs`,
  `collectServedGraphIds` in `src/components/projects/project-graphs.ts`).
  Derived from `list_graphs` and the sessions the sidebar already loads; no
  extra command. Expansion persisted per project as
  `expanded_graphs_project_ids`. Hidden when no graph is relevant. The
  project canvas (also the phone's project view) shows the same list under
  Pinned (`variant="canvas"`, always open, hidden during a search).
- Main view `GraphView` when `ui-store.activeGraphId` is set (cleared by every
  other selection, like the Archived view). Tabs: Outline, Dependencies, Review.
  Node detail panel on the right. Navigation history kind `graph`.
- New graph dialog (three locations) and "Open existing graph file…".
- Session graph panel: the **Graph tab of the left context panel** (#98, see
  `context-panel.md`; before that a right panel in `ChatWindow`). It shows the
  session on screen (`useActiveSessionTarget`), on desktop and in the phone
  drawer. Entry points (#84): the shared `SessionGraphToggle` button in the
  window toolbar (session window and full chat view; hidden for a session
  without a graph link), the ⌘K command "Toggle Graph Panel" and the
  `toggle_session_graph` shortcut (`Mod+Shift+G`). All call
  `toggleContextPanel('graph')`; the command and the shortcut go through
  `toggleActiveSessionGraphPanel` (`src/lib/session-graph-panel.ts`), which
  only toasts when no session is open. An unlinked session gets the tab with
  "This session is not linked to a graph." and "Link to Graph…".
- **Link to Graph…** (#88) for every session: session context menu (sidebar,
  canvas tabs, Starred/Pinned rows; long press on mobile) and ⌘K. Opens
  `LinkToGraphDialog` (`ui-store.linkToGraphTarget`), which shows the current
  links and adds/removes them with `ServesEditor` — the same editor as the
  panel's "Serves" section. Both use `change_session_serves`, so a UI edit never
  overwrites a ref an agent set meanwhile.
- **Simple and expert layer** (#88 follow-up). `GraphNodeDetail` and
  `SessionGraphPanel` render a simple layer first, then two foldouts from
  `GraphDetailsToggle.tsx`: `GraphRelationsToggle` ("Relationships (n)":
  relations editor + incoming in the node panel; before/after + siblings for
  a worker in the session panel, none for a whole-graph session) and
  `GraphDetailsToggle` ("Show details", the expert layer). Each is one saved
  choice for both panels: `projects-store.graphRelationsShown` /
  `graphDetailsShown`, persisted as UI state `graph_relations_shown` /
  `graph_details_shown`. Simple layer: title, parent, state (plain labels,
  `STATE_LABELS` in `graph-badges.tsx`: proposed → Idea, committed → Planned),
  `WaitingFor` (from `waitingFor()` in `graph-utils.ts`, same rules as the
  Rust blockers but with ids), open requests, description, sessions; the
  session panel has one card (worker: node, waiting for, "Next" from
  `waitingOn()`; manager: progress, requests, changes) and "Change link…"
  (opens `LinkToGraphDialog`). Expert layer: file words (id, `state
  committed`), properties, attachments, history, delete; in the panel other
  sessions, lists, outline, permission, `ServesEditor`.
- Settings → Agents pane; "Start session from agent" dialog; agent badge next to
  session names (badge when the name differs from the agent name, glyph only when
  equal).

## Implementation notes (2026-11-03)

- **Formatting:** known fields are written in a fixed order (`id, title, type,
  nodes`, then unknown fields), lists are not indented under their key. A
  hand-written file is reformatted once on its first save; after that, one edit
  changes only that node's lines (tested).
- **Blocking:** `done`/`dropped` targets never block; a `blocked-by` target that
  is not found blocks with its text; a `depends-on` target that is not found does
  not block; done or dropped nodes are never blocked. Progress also counts
  `part-of` children from other registered graphs.
- **Revert:** a `session.serves` change undoes only its own refs, other refs the
  session got since then stay. A node revert refuses when the node changed after the change; reverting a delete
  appends the node at the end and does not restore relations the delete removed
  from other nodes; a revert marks the original change as seen.
- **Cache events** are sent by the graph functions themselves (also for MCP
  writes), not by the dispatch arms.
- **Poller** is off in test builds and tested through a hook.
- **Prompt:** `session_prompt_parts` (graphs/commands.rs) is empty for a session
  without agent and `serves`; otherwise it holds the persona and a
  "Splitkick graph" block (served nodes with refs, state, file path, permission,
  "use the graph tools, give a why"). It is added once per backend, right after
  the project custom prompt.
- **UI:** `openGraphView(graphId, nodeId?)`; the side panel's tab
  (`ui-store.contextPanelTab`) is persisted as `context_panel_tab`; opening
  a node's detail marks its unseen changes as seen. On the
  phone (no sidebar) Home → Projects lists the graphs; an open graph replaces
  the tab shell and has a Back button. A failed refetch (file deleted or
  broken) shows the error instead of the last good data. The header type chip
  edits the type inline. `activeGraphId` is not persisted: a reload comes back
  without the open graph.
- **Locations:** `repoRoot` keeps the spelling of the graph path (git resolves
  /tmp → /private/tmp; the UI strips the root off the path). A branch switch
  does not change the file's mtime, so the poller does not report it; the
  warning shows on the next load of the graph list. `commit_graph` with no
  change fails with "Nothing to commit: <file> has no changes".
- **Progress** counts direct `part-of` children only: a grandchild counts for
  its own parent, not for the group above it.
- **Active** follows the run registry: the poller also compares the set of
  running sessions (`chat::registry::actively_managed_session_ids`) and sends
  `cache:invalidate` `["graphs"]` when it changes, so the badge comes and goes
  within ~2 s without a graph write.
- **Node edits in the UI** (`useUpdateGraphNode`) go into the cached graph at
  once and run one after the other (mutation scope): each list in a patch
  replaces the stored one, so a second click before the refetch must build on
  the first.
- **Properties:** a key is a label; adding an existing key replaces its value
  in place (rename = remove + add). Escape restores the title, description
  and a property value; the add-node row closes on Escape.
- **Not found:** a cross-graph ref whose graph or node does not exist shows
  "not found" (detail and outline). A same-graph id that does not exist reads
  as free text (it blocks only as `blocked-by`).
- **Dependencies:** a `depends-on` cycle is broken at the node seen again
  (A→B→A in file order: B is step 1 above A, A is step 2); both stay blocked.
  A graph without nodes shows "No nodes yet.". Opening another graph returns
  to the Outline tab.
- **Agents (asserted in `graphs-agents.spec.ts`):**
  - The persona and the agent name are read from the profile when a message
    is sent, not copied into the session: an edit in Settings → Agents reaches
    every session of that agent from its next message (the pane says so).
  - The start dialog always writes `graph_permission` (the chosen level, ≤ the
    profile's), so a session keeps its level when the profile changes later.
    MCP `create_session` with `agentId` writes the profile's level.
  - Deleting a profile (with confirmation) keeps its sessions and their
    `agent_id`: badges and the header chip disappear, the graph panel stays
    (serves or `agent_id` keep it), at the session's own `graph_permission`.
  - The session graph panel's permission select is the user acting: it may
    set any level, also above the profile's.
  - A request whose session was deleted still shows its session name;
    answering it skips the follow-up.
  - The Graph tab is one switch for all sessions: it stays open across
    session switches and follows the session on screen.
- **E2E:** `e2e/local/tests/graphs.spec.ts`, `graphs-files.spec.ts`,
  `graphs-nodes.spec.ts` and `graphs-agents.spec.ts` (see `e2e-local.md`).
