# Graphs and agents

A **graph** holds the plan for a larger job: what should exist, in which order,
and what is done. Sessions do the work; each session says which node it serves.
You are the executive: agents change the graph freely, and you review what they
did.

## Create a graph

1. In the sidebar, find **Graphs** and click **+ New**.
2. Give a title and a type (a free word such as `roadmap` or `release`).
3. Choose where the file goes:
   - **Inside a project's repo**: versioned with the project. The file is on
     whatever branch the project's main folder has checked out; a warning shows
     when that is not the default branch.
   - **In another repo**, for example a repo only for graphs.
   - **In a folder outside any repo**, for example `~/Graphs`. No git.
4. Click **Create graph**. To add a graph file that already exists, use
   **Open existing graph file…**.

A graph is a plain YAML file. You can edit it in any editor; Splitkick shows the
change within a few seconds.

## Work with nodes

- **Outline** groups nodes by `part-of`. Badges show what is computed: *active*
  (a session that serves the node runs), *blocked* (an open `blocked-by` or an
  unfinished `depends-on`) and progress.
- **Dependencies** shows the order of the work and the open decisions.
- Click a node to open it. You first see the simple view: title, state
  (Idea, Planned, Done, Dropped), what it waits for, open requests, the
  description and the sessions on it. **Relationships** opens the relations
  (edit them there) and the relations of other nodes to it. **Show details**
  adds the id, properties, attachments, history and **Delete node**. Both
  choices are remembered for every panel. The file keeps its own state words:
  `proposed`, `committed`, `done`, `dropped`.
- **Commit graph** commits only the graph file.

## Review what agents did

The **Review** tab shows:

- **Requests for you**: accept a node as done, send it back with a note, or
  answer a decision that blocks a node.
- **Changes since you last looked**, with who, when and why. Mark them seen, or
  revert one.

## Roles

A role is a session preset: a persona prompt, a graph permission and a default
model. Any number of sessions can use the same role. Edit roles in
**Settings → Roles**. (Earlier versions called a role an agent.)

| Permission | May |
| --- | --- |
| read | read graphs, set which node its own session serves |
| write | also create and edit nodes, and send requests |
| manage | also commit, accept done and drop nodes |

Start a session with a role with **Start session…** (in a graph, on a node, in
Settings → Roles, or in the command palette). The persona and the nodes the
session serves are added to its system prompt. An edit to the persona reaches
every session with that role, also running ones, with its next message. In the
session, the **Graph** button (or ⌘K **Toggle Graph Panel**, or
<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd>) opens the **Graph** tab of the
side panel on the left, next to **Files** and **Network**. It has one card: its node, what it
waits for and what comes next (or, for a whole-graph session, the progress,
requests and new changes). **Change link…** opens **Link to Graph…**;
**Relationships** shows before and after and the siblings; **Show details**
adds other sessions, the permission and the links.

## Agents

An agent is one named session in a role. It exists once: once in the whole app
(a **global** agent, for example "Assistant") or once in a project (for example
the "Release manager" of one project). Because the name is unique, you and
other sessions can send work to it by name.

- **Create one:** open the **Agents** tab in the sidebar, next to Starred, and
  select **New**. Give a name, select Global or a project, and optionally a
  role. A global agent works in a folder that you select (the default is
  `~/splitkick/agents/<name>`), for example your notes folder. It shows in the
  Agents tab only, not in the project list.
- **Make a session an agent:** right-click a session and select
  **Make Agent…**.
- **Send it work:** in any session, write "Tell the Release manager to cut
  1.5.23". The session sends the message to the agent. If the agent is busy,
  the message waits in its queue and runs next.
- **Run it on a timer:** right-click the agent's session and select
  **New Schedule…**. Or use **Send later…** / **Repeat…** next to Send in the
  agent's session, or write in any session "Every day at 7:00, tell the
  Assistant to move my open to-dos to today and send me a summary". The
  schedule belongs to the agent and shows in **Scheduled** with its name.
- **Restart:** right-click the agent's session and select **Restart Agent**
  when its context is full. A fresh session takes over and gets the history of
  the old one with its first message. The old session stays as a normal
  session. Schedules and the name go to the new session.
- **Rename, change the role, remove:** right-click the agent's session.
  **Remove Agent** keeps the session and its history.

If you archive or delete the session of an agent, the agent shows
**No session** in the Agents tab. Select **Restart** to give it a new one.
