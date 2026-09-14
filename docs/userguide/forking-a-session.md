# Forking a Session

A fork copies a session's conversation into a new session that you can continue in a
different direction. The original session does not change.

Use a fork when you want to try a second approach without losing the first, or when a
conversation went the wrong way and you want to go back to an earlier point.

## The three ways to fork

### Fork Session (same Worktree)

Makes a new session tab next to the original, on the **same** files. Both sessions work
in the same directory.

Use it to ask the same agent a different question about the same code.

Where to find it:

- Right-click the session in the sidebar, the tab bar, or a pinned row.
- Magic menu → **Fork Session (same Worktree)** (shortcut `H`).

### Fork Session (new Worktree)

Makes a new git worktree from the current branch position, copies your uncommitted
changes into it, and puts the forked session there. The two sessions then work on
**separate** copies of the files and cannot disturb each other.

Use it to try a risky change while the original session keeps working.

Where to find it:

- Right-click the session in the sidebar, the tab bar, or a pinned row.
- Magic menu → **Fork Session (new Worktree)** (shortcut `W`).

### Fork from here

Right-click any message in the chat and choose **Fork from here**. The fork keeps the
conversation up to that point and drops everything after it.

- Right-click an **agent answer** — the fork ends with that answer.
- Right-click **your own message** — the fork ends just before it, so you can write a
  different prompt at that point.

Use it to go back to the moment before the conversation went wrong.

## What the fork keeps

The fork keeps the visible conversation, the backend, the model, the thinking or effort
level, and any contexts, issues or pull requests you attached to the session.

The agent also keeps the context. A forked session is not a fresh start: the agent can
answer questions about the earlier conversation from the first message you send.

## What the fork does not keep

- Queued messages, pending permission requests and a scheduled wake-up.
- Checkpoints. You cannot restore a checkpoint that the original session took; make new
  changes in the fork and it takes its own.
- The session name is set to "Fork of \<original name\>". Jean renames it automatically
  once the fork has its own conversation.

## Limits

- You cannot fork a session while a turn is running. Wait for it to finish, or cancel it.
- Forking from a message needs that message to be part of the session's stored history.
