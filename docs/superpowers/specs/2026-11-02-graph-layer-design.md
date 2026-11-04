# Graph layer — design draft

Status: **draft from a brainstorm, 2026-11-02. Not approved.** One open
problem (the base checkout is often on another branch) blocks the storage
decision; see "Open problem". Related: #77 (session network view), #78 (graph
document), #62 (parent/child sessions).

## Why

Agent engineering has three layers (Graph Engineering, arXiv 2608.21156,
https://arxiv.org/pdf/2608.21156):

- **Harness:** what one agent can do (prompt, tools, security, context).
  Splitkick has it: backends, MCP, worktrees, execution modes.
- **Loop:** how one agent works over time. Splitkick has it: sessions.
- **Graph:** the layer above the single agent. Splitkick lacks it.

Today an orchestrating session keeps the state of a larger job in its own
context. It gets lost on compaction, nobody else can see it, and the human
is asked step-level questions ("approve this push") instead of
direction-level ones.

## Roles and layers

| Layer | Who | What |
| --- | --- | --- |
| **Roadmap** (a graph) | the user, as **executive** | What should exist and why: nodes, priorities, dependencies. Human-in-the-loop happens here, at direction level. |
| Translation | a **manager agent**: a long-lived session such as a vision keeper, project manager or orchestrator | Turns the roadmap into work: issues, sessions, order, follow-up, merge, report. |
| **Schedule** | sessions (workers) | How and when: sessions planned, running, done (#77 shows it). |

**Layer rule:** lower layers point up, higher layers never point down. A
session says "I serve node X" (`serves`, in session metadata, like
`started_by_session_id` from #62). The roadmap does not list sessions.

## Graphs

- A graph has a **title** and a **type** (a free word: `roadmap`, `release`,
  `research`, …).
- **A graph is just a file** (direction from Andreas, 2026-11-03). Its
  location is chosen when it is created:
  - **inside a project's repo** (for example `.splitkick/graphs/<slug>.yml`):
    versioned and shared with the project;
  - **in another repo**, for example a repo only for graphs;
  - **in a folder outside any repo** (for example `~/Graphs` or iCloud Drive):
    no git. This replaces the "instance graph": cross-project nodes are a
    graph file in a folder.
  Splitkick keeps a list of the graph files it knows. "Open existing graph
  file…" adds one (for example a file that came with a pull).
- Sidebar: a new section **Graphs** that looks and behaves like Starred. Each
  row shows where its file is. "+ New" asks for title, type and location.

## Nodes

A node has:

- `title`, `description`
- `state` — see below
- `properties` — free key/value, strings
- `relations` — four fixed kinds, stored on the source node; the reverse
  ("blocks", "has parts") is computed:

  | Kind | Meaning |
  | --- | --- |
  | `depends-on` | Planned order: the target must be done first (finish-to-start). |
  | `blocked-by` | A current obstacle; resolved, not "done". Target is a node or free text (a decision, an outside fact). |
  | `part-of` | Breakdown; progress rolls up. |
  | `relates-to` | Free link, no rules. |

  A target is a node id in the same graph, or `graph-id#node-id` in another
  graph (cross-project).
- `attachments` — durable data on the node, `kind: value`: `issue`,
  `milestone`, `pr`, `link`, `file`, `session` (a durable reference, e.g.
  "decided in this session"), `note`. Unknown kinds are kept and shown as text.

### State: store decisions, derive facts

| | State | Set by | Meaning |
| --- | --- | --- | --- |
| stored | `proposed` | anyone | An idea or a breakdown, not agreed. |
| stored | `committed` | permission `manage` | "We do this." Work may be scheduled. |
| stored | `done` | permission `manage` | Accepted: the outcome is what was wanted. |
| stored | `dropped` | permission `manage` | Not doing it; kept for the record. |
| derived | active / idle | schedule | Sessions that serve it are running, or not. |
| derived | blocked | relations | An open `blocked-by` or an unfinished `depends-on`. |
| derived | progress | `part-of` + schedule | Done parts; merged serving work. |

"Ready for review" is not a state: the manager sends a **request** ("node X
is done, here is the evidence"); the executive accepts it or sends it back.
Same for a `blocked-by` on a decision: the manager asks, the answer resolves it.

## Agents and permissions (KISS)

- **Agent = a saved profile**, not a new session kind: name, persona prompt,
  graph permission, optional default backend/model. A session is started
  *from* an agent; it is a normal session with the persona prompt added.
- **Session name vs agent:** a session started from an agent can be renamed.
  It keeps a reference to its agent. Where the session is listed, the agent
  shows as a badge in the agent colour when the name differs, and as a glyph
  only when the name is still the agent name. The change log names the
  session and shows the agent badge.
- **Editing profiles:** Settings → **Agents** (a pane next to Magic Prompts)
  is the one editor. Other ways in open the same pane: *Edit* on the Agents
  page, the agent chip in the header of a session started from an agent, and
  the command palette ("Edit agent…"). The persona is read on every message,
  so an edit reaches every session of that agent, also running ones, on its
  next message (decided 2026-11-03: keep it live).
- **What a manager may decide lives in its persona prompt.** The code enforces
  only one coarse level per session, in the MCP tools:

  | Level | May | Default for |
  | --- | --- | --- |
  | `read` | read graphs; set `serves` on its own session | every session |
  | `write` | create and edit nodes, relations, properties, attachments; propose | — |
  | `manage` | also commit, accept (`done`), drop | manager agents; the user always |

- **Graph panel in the session:** a session that serves a node or a graph
  gets a **Graph** button in its header and a side panel (like the review
  panel). A worker sees its node, what comes before and after, its siblings
  and what it may change. A manager sees its open requests, its changes the
  executive has not seen, and the outline.
- **The manager edits freely; the executive audits.** Every change is
  recorded: who (user or which session), what, when, and **why** (required
  for agents). The user sees "changes since I last looked" per graph, marks
  them seen, and can revert any change. Nothing waits for approval.

## Storage (as discussed; blocked by the open problem)

- Format: one YAML file per graph (`serde_yaml` is already in jean-core), at
  the path chosen at creation (see Graphs). Default inside a project repo:
  `.splitkick/graphs/<slug>.yml`.
- Splitkick keeps node and field order when writing, so diffs stay small; the
  file is readable and editable by hand. Derived values are never written.
- One **graph store** in jean-core is the only way in (UI and MCP tools), so
  the location can change later without touching anything else.
- Change log: per machine, in Splitkick's data; changes from other machines
  show in git history.
- No auto-commit in v1: a "Commit graph" action stages only the graph file
  (the base checkout is shared with other sessions).

Example:

```yaml
id: 3f2c9e1a-0000-4000-8000-000000000000   # stable across renames
title: Splitkick roadmap
type: roadmap
nodes:
  - id: k7m2qd                             # short, random, unique in the graph
    title: Graph support v1
    description: |
      Roadmap/schedule split, nodes, agents.
    state: committed
    properties:
      quarter: 2026-Q4
    relations:
      - depends-on: x91ffa
      - blocked-by: "decision: storage for multi-machine sync"
      - part-of: r00t01
      - relates-to: 8b0d0000-0000-4000-8000-000000000000#a1b2c3
    attachments:
      - issue: azeitler/splitkick#78
      - milestone: azeitler/splitkick/Graph v1
      - link: https://arxiv.org/pdf/2608.21156
```

## Open problem: which copy of a project graph is the real one

**Update 2026-11-03:** with "graphs are just files, the location is chosen at
creation", the problem applies only to a file **inside a project's repo**. A
file in a repo of its own (which stays on its default branch) or in a folder
outside any repo does not have it. The mockup shows this as option 5.

A committed file exists once per worktree, and the UI must show one. The
draft decision was: **the real copy is the file in the project's base checkout
(the main folder); the UI and all MCP tools read and write only that file;
worktree copies are ignored.**

**The problem (raised by the user): the base checkout is often on another
branch.** Then the "real" roadmap silently changes with whatever branch is
checked out, edits land on a feature branch, and two machines on different
branches see different roadmaps. This happens a lot, so a warning is not
enough.

Options to discuss (not decided):

1. **Dedicated branch**, e.g. an orphan branch `splitkick/graphs` checked out
   in a hidden worktree only Splitkick touches. Splitkick commits there (and
   pushes, so other instances pull). Independent of what the base checkout
   has checked out. Cost: Splitkick manages a worktree, commits and pushes;
   push rules (user approval) apply.
2. **Read from the default branch, not the working tree** (`git show
   origin/main:.splitkick/graphs/x.yml`), write through a small commit on the
   default branch without checking it out (git plumbing: `hash-object`,
   `update-index` on a temporary index, `commit-tree`, `update-ref`). No
   worktree, but writing to `main` without a checkout is unusual and races
   with the user's own commits.
3. **Not in git at all for v1:** every graph lives in Splitkick's data (like
   the instance graph); sharing between instances goes through Splitkick's
   existing sync/backup or remote connections instead of git. Simplest; loses
   "versioned with the repo".
4. **Pin the copy to the default branch's worktree** if one exists, else fall
   back to the base checkout with a blocking notice. Small, but does not solve
   the case it is meant for.

Questions for that discussion: how many machines edit the same graph at the
same time; whether "versioned in the repo" is a must for v1; whether Splitkick
may push on its own to a dedicated branch.

## Not in v1

- A runner that starts sessions automatically when a node's inputs are ready.
- Rich graph drawing beyond a simple view (Mermaid from #74 may help later).
- Fine-grained permissions beyond `read` / `write` / `manage`.
- Markdown export of a graph.

## Next step

A clickable mockup (static HTML in `docs/mockups/graph-layer/`) to make the
model concrete before the storage decision: sidebar section, graph views,
node detail, review of manager changes, requests to the executive, and the
branch problem shown in the UI.

## Phased plan

1. **Graph files and the outline** (first build issue: #79). Graph store in
   jean-core (YAML files at the chosen path, a list of known files), nodes,
   `serves` on sessions, derived active/blocked/progress, sidebar section,
   New/Open dialog, outline view, node detail, MCP read/write tools with a
   required why, change log recorded (not yet reviewed). Full rights for every
   session; no permission levels yet.
2. **Review.** Changes since you last looked, mark seen, revert; requests to
   the executive (accept done, answer a decision).
3. **Agents.** Profiles in Settings → Agents, start a session from an agent,
   permission levels in the MCP tools, graph panel in the session, agent badge.
4. **More views and links.** Dependencies view, cross-graph relations, the
   storage decision for graph files inside a project repo.

Not planned: the runner (automatic start of sessions).

## Mockup

Clickable mockup: [`docs/mockups/graph-layer/`](../../mockups/graph-layer/) (open
`index.html`; screens, screenshots and the design questions it raised are in its `README.md`). It
shows the sidebar section, outline and dependency views, node detail, the executive's review
(requests and change log), agents, and the open problem as four storage options, each in a normal and
a failure state. It does not decide the storage.
