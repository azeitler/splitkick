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

## Agents

An agent is a saved profile: a persona prompt, a graph permission and a default
model. Edit them in **Settings → Agents**.

| Permission | May |
| --- | --- |
| read | read graphs, set which node its own session serves |
| write | also create and edit nodes, and send requests |
| manage | also commit, accept done and drop nodes |

Start a session from an agent with **Start session…** (in a graph, on a node, in
Settings → Agents, or in the command palette). The persona and the nodes the
session serves are added to its system prompt. An edit to the persona reaches
every session of that agent, also running ones, with its next message. In the
session, the **Graph** button opens a panel with one card: its node, what it
waits for and what comes next (or, for a whole-graph session, the progress,
requests and new changes). **Change link…** opens **Link to Graph…**;
**Relationships** shows before and after and the siblings; **Show details**
adds other sessions, the permission and the links.
