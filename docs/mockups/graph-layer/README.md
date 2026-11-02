# Graph layer (mockup)

Mockup for [azeitler/splitkick#78](https://github.com/azeitler/splitkick/issues/78). It shows the
design draft `docs/superpowers/specs/2026-11-02-graph-layer-design.md` (not approved) as screens.

Open `index.html` in a browser. It is one file, with no build step and no network. The buttons above
the window select a screen. The state is kept in the URL hash (for example `#s=deps&theme=dark` or
`#s=problem&opt=default&fail=1`), so you can link to each screen directly. Many controls in the window
work: open a node, change its state, answer a request, mark changes seen, revert a change, and select
an agent or a location in the dialogs. Changes are not saved; a reload resets them.

The colours come from `src/App.css` (light `:root` and `.dark`). The row sizes and indents come from
`sidebar-row-styles.ts`, `SidebarSectionRow.tsx` and `SidebarStarredSection.tsx`. The demo data is
Splitkick's own roadmap (#62, #71, #72, #74–#78) with cross-project links to `splitkick-website` and
`splitkick-docs`.

Screenshots are in `screenshots/` (WebKit, 2×, light and dark). To capture them again, run
`node tmp/graph-shots/capture.mjs` from the repo root. The script is not tracked.

## Screens

| # | Screen | Shows |
| --- | --- | --- |
| 1 | Sidebar + New graph | A **Graphs** section below Starred, with the same header row, guide line and `+ New` as Folders and Projects. A graph row shows the title and `type · where the file is` (a project repo, another repo, or a folder with no git). An orange count = requests for you; a grey count = changes you have not seen. **A graph is a file.** The dialog asks for title, type (a free word with suggestions) and where the file goes: *inside a project's repo*, *in another repo* (for example a repo only for graphs) or *in a folder outside any repo*. It shows the path and what Splitkick finds there (git repo and branch, or no git). *Open existing graph file…* adds a file that already exists. |
| 2a | Outline | Nodes grouped by `part-of`, with a progress bar for each group. A chip shows the stored state. Badges show the **derived** values: *active* (a serving session runs), *blocked* (open `blocked-by` or unfinished `depends-on`), *done? waiting for you* (open request). An orange dot = changed since you last looked. Dashed rows with ↗ are nodes in other graphs that link here. |
| 2b | Dependencies | A Gantt-like view. Columns are dependency **steps**, not dates. Lanes are `part-of` groups. The first column holds open `blocked-by` decisions (red diamonds). Red arrows = `depends-on` on a node that is not done; grey = done; dashed blue = a relation to another graph. |
| 3 | Node detail | Description, state (segmented control), the permission of the viewer (select **view as**: you, a manage session, a write session, a worker session), properties, relations stored on the node, reverse relations **computed** from other nodes (also across graphs), attachments, serving sessions (derived from `serves`), and history. A node from another graph opens read-only. |
| 4 | Review (executive) | Left: **requests** from the manager. *Accept done* (with evidence) or *send back* with a note. Answer a *blocking decision*, which resolves the `blocked-by`. Right: **changes since you last looked**, grouped by node, each with what, why, who (and their permission) and when. *Seen* per node, *Mark all seen*, *Revert* per change. Below the line: changes you saw before. |
| 5a | Agents | Profiles: name, model, persona prompt, permission (`read` / `write` / `manage`), running sessions. A table of what each level may do. |
| 5c | Edit agent (Settings) | Settings → **Agents**, a pane next to Magic Prompts: the list of profiles and the editor (name, colour, persona prompt, permission, default backend/model, effort/mode, default *serves*, where the profile is stored). A box lists the four ways in: this pane, *Edit* on the Agents page, the agent chip in a session header, and the command palette. |
| 5b | Start session | Agent, project and checkout, `serves` (a graph or a node), the permission for this session (only lower than the profile), the persona prompt, the first message. |
| 7 | Session graph panel | A session that serves a node or a graph gets a **Graph** button in its header and a side panel, like the review panel. **Worker** (*Network view*, serves #77, permission read): its node, before and after (depends on, needed by), its siblings in the group with "this session" marked, other sessions on the node, what it may change. **Manager** (*Vision keeper*, serves the whole graph, manage): open requests, its changes the executive has not seen, the outline. The agent chip in the manager's header opens the profile editor. Switch *Worker session* / *Manager session* above the window. |
| 6 | Open problem | The same graph under each storage option, with **Normal** and **Failure case**. The location chips, the sync status and a banner show what the user sees. A comparison table is below. |

### Screen 6: options shown

- **Draft decision (file in base checkout).** Normal: the base is on `main`. Failure: the base is on
  `issue-74-mermaid`. The roadmap is the one from that branch, 2 nodes differ from main, and edits land on
  that branch.
- **Option 1: dedicated branch** `splitkick/graphs` in a hidden worktree. Normal: synced, 1 commit not
  pushed, and a checkbox to let Splitkick push without asking. Failure: push rejected because mb16 pushed
  too. Merge per node, with a field-level conflict (keep mine / take theirs).
- **Option 2: read the default branch** (`origin/main:` as a git object, write with plumbing). Normal: read
  at a commit, local main 1 ahead. Failure: `main` moved because of your own commit in the base checkout,
  so the ref update failed. Retry / show diff / discard.
- **Option 3: Splitkick data only.** Normal: synced with mb16 through Splitkick. Failure: mb16 is offline
  and both edited. Merge on reconnect; *Export snapshot to repo*.
- **Option 5: own repo or folder.** This follows the direction "graphs are just files; the location is
  chosen at creation". Normal: the file is in `azeitler/roadmaps`, a repo only for graphs, which stays on
  `main`. Failure: the local copy is behind origin and has 1 change not pushed: an ordinary pull and merge.
  The branch problem stays only for a file inside a project repo.
- Option 4 (pin to the default branch's worktree) is not shown. When no such worktree exists, it falls back
  to the draft decision.

## Design questions the mockup raises

Graphs and sidebar

1. Does the sidebar badge count requests, unseen changes, or both? The mockup shows requests (orange)
   before changes (grey), and one count only.
2. Are graphs a fourth sidebar section (scrolling with Starred, Folders, Projects, and sticky like them)?
   Or are they a tab next to Projects / Recent? Many graphs make the section long.
3. Is the graph type only a free word, or does it change the UI (for example, `release` shows a
   milestone and a date)?
4. Can a graph file move later (to another repo or folder)? Splitkick must update its list of known
   files, and cross-graph references (`graph-id#node-id`) must survive. That is why the graph id lives
   in the file.
4a. How does Splitkick find graph files? Only the ones created or opened in it (a list), or also by a scan
    of `.splitkick/graphs/` in every project?
4b. A graph file in a folder outside any repo, changed by another program or a sync tool: does Splitkick
    reload it without asking? What if the file has an unsaved change in Splitkick too?

Nodes, state and derived values

5. The Dependencies view has no time axis because nodes have no dates. Is a `due` / `quarter` property
   with a meaning wanted, or do "steps" give enough order?
6. Is a group (a node with parts) also a normal node with its own state? In the mockup it is. Then can a
   group be *done* while parts are open?
7. *Blocked* counts every `depends-on` that is not done. Should a `depends-on` on a *proposed* node block,
   or only one on a *committed* node? Many nodes now show "blocked", which is noise.
8. What does *active* mean for a group? Any part active, or only sessions that serve the group itself?
9. A cross-graph node shows read-only, and its reverse relation shows here. Is that enough, or must the
   user be able to edit the relation from both sides? (The relation is stored only in the other file.)
10. A cross-graph target in a graph the machine does not have (another project not cloned): how does it
    show?

Review and audit

11. Is "last looked" per graph, per machine, or per user? The change log is per machine, so changes made
    on mb16 do not show on mb14 in this review. Is that acceptable?
12. Revert of one change when later changes depend on it (for example, a created node that was then
    linked): undo only that change, or refuse?
13. Is a *why* required for the user too? The mockup makes it optional for the executive and required for
    agents.
14. *Send back* with a note: does it go into the manager session as a message (it wakes the session), or
    only onto the node?
15. Requests: a separate list, or a node attachment of kind `request`? Where do answered requests stay?

Agents and permissions

16. A write agent sets state only to *proposed*. Can it still drop a node it created itself?
17. Is the permission per session fixed at start, or can the user raise it later (for example, for a
    blocked manager)?
18. Does an agent profile belong to the instance or to a project (persona in the repo)?
18a. Are agent profiles files too (for example `.splitkick/agents/<name>.md` next to the graphs), so they
    are versioned and shared like graphs? Or are they Splitkick settings on each machine?
18b. Edits to a profile apply only to new sessions. Is a "restart with the new persona" action wanted for
    a running manager?
19. Does the manager serve the whole graph (`serves: graph:roadmap`), or only nodes? The mockup lets it
    serve a graph.

Session graph panel

25. Is the panel open by default in a session that serves a node, or only with the **Graph** button?
26. A session that serves nodes in two graphs: one panel with a node picker, or one section per node?
27. A worker with `read` permission cannot change its node. Is "Note to manager…" (a message into the
    manager session) the right way, or should a read session be able to send a request?
28. Does the manager's panel replace the graph view for daily work, or only point to it?

Storage (open problem)

20. How many machines edit the same graph at the same time? (This decides between option 1 and 3.)
21. Is "versioned with the repo" a must for v1, or is "export snapshot" enough?
22. May Splitkick push a dedicated branch without asking? Push rules today require approval, and the
    failure case of option 1 depends on this.
23. Option 2 writes to `main` without a checkout. Is that acceptable on repos with branch protection?
    (The push would be rejected.)
24. "Commit graph" stages only the graph file. Under option 1 or 2, is this button still needed, or does
    every change commit itself?
