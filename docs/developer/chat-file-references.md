# File references in chat

A path written in a chat answer, or typed as an `@`-mention, is a bare string.
`docs/api.md` may be relative to the worktree, to a package inside it, to a
linked project, or to wherever a tool happened to run. Nothing in the string
says which.

Jean used to join the reference onto the worktree root and hope. That is right
often enough to look correct and wrong often enough to be infuriating: a
monorepo path opened nothing, a file the agent wrote in a subdirectory opened
nothing, and a reference to a file that had since moved opened nothing. Worse,
a dead link looked exactly like a live one until it was clicked.

## How a reference resolves now

`useFileReference(ref)` in `src/lib/file-reference.ts` orders the places the
file could be and asks the backend which of them exist.

1. **An absolute reference** is itself. It still gets confirmed.
2. **Paths the session's tool calls touched**, newest first. A Read or an Edit
   records an absolute `file_path`, which is the only record of where the
   agent really was. A reference matches one when it is its tail at a
   separator boundary: `docs/api.md` matches
   `/repo/packages/web/docs/api.md`, and `cs/api.md` does not.
3. **The roots**, joined with the reference: any root the caller adds (a
   linked project, for `FileMentionBadge`), then `LocalPathRootContext`, then
   the store's active worktree.
4. **A bounded search of the worktree**, run by the backend only when nothing
   above exists. Breadth-first, skipping `node_modules` and friends, capped at
   20,000 entries and 8 matches, shallowest match first.

`resolve_file_reference` (`jean-core/src/projects/commands.rs`) does the
stat'ing and the search. It returns every match, not only the first — which is
what lets the UI ask rather than guess.

## What the UI does with the answer

| Result       | Link                                          | Mention badge                     |
| ------------ | --------------------------------------------- | --------------------------------- |
| one match    | opens exactly that path                       | previews that path                |
| more matches | click opens `FileReferencePicker`             | same                              |
| no match     | no link: dotted text, question-mark icon, tip | question-mark icon, dimmed, inert |
| resolving    | the old join, so nothing feels sluggish       | the old join                      |
| failed       | the old join                                  | the old join                      |

Not drawing a link is the part worth defending. A link that can only open an
error is worse than no link, because it looks the same as one that works. The
reference is still marked as a file, though — dotted underline and a
question-mark icon — because plain text would hide that the answer named a file
at all. `MissingFileReference` in `src/components/ui/missing-file-reference.tsx`
draws it; its tooltip says what was checked, so "not found" does not read as
"did not try". The marker is focusable and takes the tab stop the link would
have had, so the explanation is reachable from the keyboard.

## Publishing the evidence

`ChatWindow` calls `useFileReferenceEvidence({ worktreePath, messages,
isSending })`. Three things about it are deliberate:

- **It is a module-level registry keyed by worktree root, not a React
  context.** A context needs a provider element around the thread, and
  wrapping `ChatWindow`'s tree re-indents 2,400 lines of it. Keying by
  worktree means the main window and the canvas modal cannot overwrite each
  other.
- **It publishes during render, in a `useMemo`.** React runs a child's effects
  before its parent's, so an effect here would arrive after every link below
  had already resolved itself — and the first render is the one that matters.
- **It stores the message array, and walks it on lookup.** A streaming answer
  republishes on every chunk; a `Map.set` per chunk is free, a walk of every
  tool call would not be.

The end of a turn invalidates the `['file-reference']` query key. An answer can
name a file before the agent writes it, and that reference resolves to nothing;
re-checking when the turn finishes makes the link appear on its own.

## Adding a backend

`PATH_INPUT_KEYS` in `src/lib/file-reference.ts` lists the tool-input fields
that name a file: `file_path` (Claude), `path` (Codex, Cursor),
`notebook_path`, and a few spellings. A new backend that names the field
something else contributes no evidence until it is added there. Nothing breaks
— resolution falls back to the roots — but the monorepo case stops working for
that backend, so add the key and a case to
`src/lib/file-reference.test.ts`.
