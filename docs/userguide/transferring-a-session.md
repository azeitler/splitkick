# Transferring a Session to Another Machine

A transfer copies a session, with its whole conversation, to another Splitkick that you
have saved as a remote connection. You can then continue the work on that machine. The
session on this machine does not change.

## Before you start

- Save the other machine as a connection (sidebar → connections).
- The other machine needs the same code. Push your branch, then pull it there, or
  create a worktree for that branch on the other machine.
- Both instances need a version with session transfer. An older instance shows
  "Update Splitkick on \<name\>".

## Transfer a session

1. Right-click the session in the sidebar, the tab bar, or a pinned row, and choose
   **Transfer to Remote Splitkick…**. Or open the command palette and run
   **Transfer Session to Remote Splitkick…**.
2. Choose the connection, the project and the worktree. Splitkick preselects the project
   with the same name and the worktree on the same branch.
3. Click **Transfer**. A message shows the progress. When it is done, click **Open** to
   go to the other machine's window.

The new session is the active tab of the worktree you chose.

## What the transfer keeps

- The visible conversation, the backend, the model, the thinking or effort level and
  the mode.
- Images and text files that you pasted into the conversation.
- Saved contexts that you attached to the session.

The agent also keeps the context. From your first message on the other machine, the
agent can answer questions about the earlier conversation.

## What the transfer does not keep

- Your code. Push and pull the branch yourself.
- Attached GitHub, Linear and Sentry issues or pull requests. Attach them again.
- Checkpoints.
- A turn that is still running. The transfer starts from the last finished answer.

## Limits

- In Web Access in a browser, the target must allow the page's address. Start the target
  with `JEAN_ALLOWED_ORIGINS=<address of this page>` (for example
  `https://splitkick.example.com`). Otherwise the transfer fails with "Could not reach …".
  The desktop app needs no setting.
- The menu item shows only when you have a connection other than the one this window
  shows.
