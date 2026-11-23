# Agents and roles

Two things that were one word before:

| Term      | What it is                                                                                                                                                                                           |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Role**  | A session preset: persona, color, backend, model, graph permission (`RoleProfile` in `AppPreferences.role_profiles`). Any number of sessions can use it. Until 2026-11 this was the "agent profile". |
| **Agent** | A named, unique role holder: a record that points to exactly one current session. It exists once in its scope, and other sessions send it work by name.                                              |

Spec: `docs/superpowers/specs/2026-11-21-agents-design.md` (local, not tracked).

## Data

`agents.json` in the app data directory (`jean-core/src/agents/store.rs`),
snake_case:

```jsonc
{
  "id": "uuid",
  "name": "Release manager",
  "scope": { "kind": "project", "project_id": "…" }, // or { "kind": "global" }
  "role_id": null, // a RoleProfile id, optional
  "session_id": "…", // the current session; null = "No session"
  "worktree_id": "…", // where the agent runs and restarts
  "past_session_ids": [], // newest first
  "home_project_id": null, // the hidden project a new global agent owns
  "created_at": 0,
}
```

Rules, enforced in the store's write path:

- A name is unique in its scope, compared without case and outer spaces.
- A session is the current session of one agent at most.

Scope is about naming and addressing only. Where the agent runs is
`worktree_id`: the worktree of an adopted session, the base session of a
project, or the base session of a hidden plain project.

The commands return `AgentView` (camelCase, `src/types/agents.ts`). Its
`projectId` is the project the workspace is in, also for a global agent: the
UI needs it to open the session. Group by `scope`, not by `projectId`.

## Old names still load

`role_profiles` has the serde alias `agent_profiles`; `role_id` on `Session`,
`SessionMetadata`, the graph actor and graph requests has the alias `agent_id`
/ `agentId`. The dispatch command `set_session_agent` and the argument
`agentId` (dispatch and MCP `create_session`) are still read. Do not remove
the aliases: preferences, session metadata and graph change logs on disk use
the old names.

## Hidden plain projects

A new global agent runs in a folder the user picks (default
`~/splitkick/agents/<name>`). The folder becomes a plain project
(`docs/developer/plain-projects.md`) with `Project.hidden = true`, so every
session feature works without change. If the folder already is a project, the
agent runs in that project's base session and no hidden project is made.

- **A list of projects for the user filters with `isVisibleProject`**
  (`src/types/projects.ts`): the tree, the pickers, the command palette. MCP
  `list_projects` filters too.
- **A lookup by id does not filter**, so the agent's own session still finds
  its project.

Removing the agent un-hides the project: it becomes a normal plain project,
and the session and its history stay reachable. Nothing on disk is deleted.

## An agent never points at a dead session

- `agents::session_gone(app, session_id)` is called by `archive_session` and
  `close_session`. **A new path that archives or deletes a session should
  call it.**
- `list_agents` and `agents::current_session` heal what other paths miss.
  `session_state` sorts a pointer into three cases, and only the first two
  are certain:
  - **Live**: the session exists (also one that never sent a message and has
    no metadata file yet), is not archived, and its worktree exists and is
    not archived.
  - **Gone**: archived or deleted. The pointer is dropped and the id goes to
    `past_session_ids`. Healing emits `cache:invalidate`.
  - **Unknown**: the metadata cannot be read, or the worktree was archived
    automatically because its folder is missing (a drive that is not
    mounted). The agent shows no session, but keeps its pointer.
- The Agents tab asks for the agents again when one points at a session the
  loaded session list does not have, so a path that told nobody still ends
  in a "No session" row.
- Auto-archive skips a worktree that holds an agent's current session
  (`Facts.has_agent` in `projects/auto_archive.rs`).
- A project agent's session cannot move to another project
  (`agents::check_session_move`); after a move inside the rules the agent's
  `worktree_id` follows (`agents::session_moved`).
- Removing a project removes its agents (`agents::remove_for_project`).

An agent with no session shows as "No session" and offers Restart. A
project agent keeps its place in its project's group when its workspace is
gone, and Restart then continues in the project's base workspace (the same
for a global agent with a home of its own).

## Addressing (MCP)

- `list_agents { projectId? }`: agents with scope, role and current session.
- `send_to_agent { agent, message, projectId? }`: `agent` is an id or a name.
  A name resolves in the caller's project first, then among the global
  agents; a name that only project agents carry is taken when exactly one has
  it (`store::resolve`). The message goes into the session's queue
  (`enqueue_message` + `trigger_backend_queue_drain`), so a busy agent takes
  it as its next turn. The tool returns at once; the caller reads the result
  with `get_session_status` and `read_session_messages`.
- The agent knows its name: `graphs::session_prompt_parts` adds one line
  ("You are the Splitkick agent …"), and `get_current_context` returns
  `agent`. The role persona line reads "You act in the Splitkick role …".

## Restart

`restart_agent` creates a new session in `worktree_id` with the same role,
sets `SessionMetadata.pending_handoff_from` to the old session, and moves the
pointer. The first send of the new session then hands over the old session's
history as a fork handoff (`with_restart_handoff` in `chat/commands.rs`; any
other handoff wins). The marker is cleared by the first turn that finishes
(`run_log::complete`), like `pending_fork`, and a fork does not copy it. The
old session stays as a normal session. If the pointer cannot move, the new
session is removed again.

## Schedules

`ScheduleTarget::Agent` with `Schedule.agent_id`: the session is resolved
when the schedule fires (`schedules::resolve_agent_target`), so the schedule
follows the agent through a restart. `cancel_session` leaves such a schedule
alone. A missing agent or session fails the run with a clear error and pauses
the schedule.

Three ways make one, and all end in the same target:

- MCP `create_schedule { agent }`.
- **New Schedule…** in the agent's context menu (`AgentDialog`, mode
  `schedule`), which sends `target: 'agent'` with the agent's session.
- **Send later…** / **Repeat…** in the composer of an agent's session.
  `schedules::create` turns a schedule into the session of an agent into an
  agent schedule; "a new session each run" stays what it is. The dialog
  (`ScheduleDialog`, prop `agentName`) names the agent as the target.

## UI

- Sidebar tab **Agents** (`SidebarAgentsSection`): "Global" first, then one
  group per project. Each agent is a row that opens and closes (open by
  default; collapsed ids persist as `collapsed_agent_ids` in UI state). Under
  it: the current session with the sessions it started indented below it
  (`started_by_session_id`, the session-network links, from
  `list_all_sessions`; archived children left out), then the past sessions
  from `pastSessionIds`, newest first. A past session only counts its
  children ("6d ago · 2 children"). An archived past session opens by
  restoring it. A deleted one, or one in an archived workspace, is not in
  `list_all_sessions` and is left out. The rows under an agent hide the
  agent badge (`showAgentBadge={false}`), which would repeat its name.
- `AgentDialog` (mounted in `MainWindow`, opened through
  `ui-store.agentDialog`): new agent, make a session an agent, rename.
- Session context menu (`SessionAgentMenuItems`): Make Agent…, or Rename
  Agent…, Agent Role, Restart Agent, Remove Agent.
- `AgentBadge` marks the session of an agent wherever `RoleBadge` shows.
- Settings → **Roles** (`RolesPane`) edits the presets.

## Backup

The session backup (`session_backup`) copies `agents.json` and
`schedules.json` beside `sessions/`, so a restored backup still knows which
sessions an agent held. There is no restore of these files yet.

## Not built

A reply from the agent into the calling session, event triggers, and an
Agents tab in the phone layout.
