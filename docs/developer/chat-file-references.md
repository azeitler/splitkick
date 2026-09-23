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

1. **An absolute reference** is itself. It still gets confirmed. So is a
   **home-relative** one (`~/Downloads/report.html`): the frontend passes it
   through untouched, and `resolve_file_reference` expands `~` with
   `dirs::home_dir()`. Only the backend can — the frontend does not know the
   home directory, and on a remote connection the file is in the backend's
   home. A missing `~/…` file is not searched for in the worktree: it names
   one place, and a worktree file with the same tail is not what was meant.
   `~user/…` is not expanded.
2. **A parent-relative reference** (`../shared/api.md`) climbs out of a base
   Jean does not know — the worktree, or a subdirectory the agent was working
   in. Both readings are offered: tool calls are matched on the part after
   the leading `../` segments (an absolute path never spells `..`), and the
   root join is offered with its `..` resolved (`normalizeDotSegments`, and
   `normalize_lexically` on the backend). The worktree search matches that
   same tail. A `..` in the middle (`docs/../README.md`) is collapsed first.
3. **Paths the session's tool calls touched**, newest first. A Read or an Edit
   records an absolute `file_path`, which is the only record of where the
   agent really was. A reference matches one when it is its tail at a
   separator boundary: `docs/api.md` matches
   `/repo/packages/web/docs/api.md`, and `cs/api.md` does not.
4. **The roots**, joined with the reference: any root the caller adds (a
   linked project, for `FileMentionBadge`), then `LocalPathRootContext`, then
   the store's active worktree.
5. **A bounded search of the worktree**, run by the backend only when nothing
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

## The reference is what is shown

Resolution decides which file to open. It does not decide what to print. A
reference is written for a person — `~/Downloads/report.png` — and its
expansion is noise, so the written form travels beside the resolved path:

- `openChatLink()` passes it as the second argument of
  `openUrlInEmbeddedBrowser()` and as the `label` of `setViewingFilePath()`.
- `BrowserTab.label` feeds the address bar and the tab name
  (`shownUrl()` in `BrowserToolbar`). Navigating the tab elsewhere drops it,
  because it then describes nothing. Enter on an untouched label re-opens the
  same tab rather than going through `normalizeUrl()`, which would read
  `~/a.png` as a host name.
- `useUIStore.viewingFileLabel` feeds the file viewer's title and subtitle.

The picker is the exception. It lists real files to choose between, so it
shows where each one is, shortened against the shared root.

## Parsing a path out of an answer

Two things in an answer's text destroy a path before any of the above runs:

- **A single tilde.** GFM reads `~x~` as strikethrough, so iCloud's
  `com~apple~CloudDocs` arrived as `com<del>apple</del>CloudDocs` and the
  reference was already wrong. `remarkGfm` is configured with
  `singleTilde: false`.
- **A space.** The prose rule in `remark-local-file-links` cannot allow
  spaces: nothing says where "see report file.html" ends. A line that holds
  nothing but one path is unambiguous, though, so that case is matched whole.
  The line must start at a root, and must hold exactly one path — otherwise
  `/tmp/a.png and /tmp/b.png` would become a single link.

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
