# Mentions (`@`)

Type `@` in the chat input to point the agent at something. The picker shows
files and Splitkick objects:

| Group       | What it inserts                                     | Second line                |
| ----------- | --------------------------------------------------- | -------------------------- |
| Files       | `@file.ts`, and the file is attached to the message | the path                   |
| Sessions    | `[Fix login](splitkick://session/<id>)`             | project › worktree         |
| Projects    | `[Acme](splitkick://project/<id>)`                  | the project folder         |
| Worktrees   | `[fuzzy-tiger](splitkick://worktree/<id>)`          | the worktree folder        |
| Agents      | `[Release manager](splitkick://agent/<id>)`         | global or project agent    |
| Connections | `[Mac 2](splitkick://connection/<id>)`              | the host of the server URL |

Files work as before: the scope buttons at the top (and `Ctrl+Shift+←/→`)
switch between this worktree and linked projects.

## Search and order

Type after the `@` to search all groups at once. A search can not contain a
space: type `@releasenot`, not `@release not`.

- While you only typed `@`, files come first. Each object group shows its 5
  most likely items: items of the current project first, then the most recent.
- When you type a name, the group with the best match moves to the top, so
  `@release` puts a session called "Release notes" above a file that matches
  a few letters.
- A query with `/` or `.` (for example `@src/app`) keeps files first.

Use `↑`/`↓` to move, `Enter` or `Tab` to insert, `Esc` to close.

## What the agent does with a mention

A mention is a markdown link. The agent reads the link and uses the Splitkick
MCP tools to open the object: it reads the messages of a session, gets the
details of a worktree or project, sends work to an agent, or runs a tool on the
other machine of a connection. The Splitkick MCP server must be on for the
session.

In the sent message the link shows the object's icon and name. Click it to open
the object:

- a session opens in its project; an agent opens its current session;
- a worktree or project opens its canvas;
- a connection opens its window (desktop app). If this window or browser does
  not have the connection saved, Splitkick tells you to add it under
  **Server connections**.

A link to an object that was archived or deleted shows a badge and does not
open.

## Web access

The picker works the same in a browser. The Connections group shows the
connections saved on the server you are connected to, because those are the
ones the agent can use. It does not show the connections saved in the browser
itself.
