# Plain projects (no git)

A **plain project** is a project folder without git (#93): paperwork, notes,
research, a shared folder or a NAS. It has only its **base session**, which
runs in the project folder. Chat, files, artifacts, graphs and links work as
usual. Every git feature is off: worktrees, git status polling, diffs,
commits, pull requests, push/pull, branches, checkpoints and the
GitHub/Linear/Sentry badges and lists.

Name it "plain project" in UI, docs and code. "Folder" already means a
sidebar group (`Project.is_folder`).

## Data

| Field          | Rust `Project`                                        | TS `Project`             | Meaning                                                                                                           |
| -------------- | ----------------------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `is_git`       | `bool`, `#[serde(default = "default_is_git")]` (true) | `is_git?: boolean`       | False = plain project. Old `projects.json` files have no field and stay git projects.                             |
| `git_detected` | `bool`, recomputed in `load_projects_data_internal`   | `git_detected?: boolean` | Plain projects only: the folder has a `.git` now. The UI offers "Switch to git project". Never trusted from disk. |

`default_branch` is empty for a plain project. Its base session is named
after the folder (`base_session_name` in `projects/commands.rs`).

## The gate: one predicate

Every git feature checks the project kind through one predicate. Do not add
per-component checks of `is_git`.

- **Rust:** `Project::is_plain()` / `Project::ensure_git()` and the
  `ProjectsData` helpers `is_plain_project`, `ensure_git_project`,
  `ensure_git_worktree` (`jean-core/src/projects/types.rs`). The error text
  comes from `plain_project_error`, so UI, web dispatch and MCP agree.
- **TypeScript:** `isPlainProject(project)` (`src/types/projects.ts`), plus
  `useIsPlainProject(projectId)` and `isPlainProjectId(projectId)` in
  `src/services/projects.ts` for hooks and callbacks. A project that is still
  loading is **not** plain, so git projects render exactly as before.

Where the gate is used:

- **Backend:** `create_worktree`, `create_worktree_from_existing_branch`,
  `checkout_pr`, `import_worktree`, `get_worktree_changes` /
  `get_worktree_diff` (via `resolve_worktree_and_project_default`),
  `checkpoints::create_checkpoint` (a plain folder inside a parent repo would
  otherwise write refs there), the polling commands in
  `background_tasks/commands.rs`, the auto-fix scheduler, session backups
  (`git_remote`) and the session overview's open-work count.
- **MCP:** `ensure_mcp_git_tool` in `jean_mcp_core.rs` runs before every tool.
  `GIT_PROJECT_TOOLS` (by `projectId`) and `GIT_WORKTREE_TOOLS` (by
  `worktreeId`) list the tools that need git. A new git tool must be added to
  one of the lists. `list_projects` adds `kind` (`git`, `plain`, `folder`);
  `get_project_context` has `kind` too.
- **Frontend:** active-worktree polling (`MainWindow.tsx`), the PR/status
  sweep (`usePrWorktreeSweep.ts`), the sidebar row and its context menu
  (`ProjectTreeItem.tsx`, `ProjectContextMenu.tsx`), the canvas badges,
  actions menu, issues column and status refresh (`ProjectCanvasView.tsx`),
  the session header (`SessionChatModal.tsx`, `WorktreeDropdownMenu.tsx`),
  the magic menu (`MagicModal.tsx`, `MobileToolbarMenu.tsx`), git keyboard
  shortcuts (`useMainWindowEventListeners.ts`), ⌘K GitHub commands
  (`github-commands.ts`), `@` mentions of issues/PRs, the GitHub dashboard,
  and the Integrations/Mr. Robot settings panes.
- **New Worktree modal:** gated once in `MainWindow.tsx`. Every opener
  (button, ⌘N, badge, command palette) sets `newWorktreeModalOpen`; for a
  plain project the modal does not render and a toast explains why.

## Adding and switching

- `add_project(path, parentId, plain)`: with `plain: true` any folder is
  added; nothing is written into it. Without it a non-git folder fails with
  "not a git repository", and `AddProjectDialog` opens `GitInitModal`, which
  offers **Add without git** and **Initialize Git**.
- `set_project_is_git(projectId, isGit)`: to git needs a `.git` (it reads the
  branch again and renames the base session); to plain needs no worktrees
  besides the base session. A git project that loses its `.git` is never
  switched by itself.
- Project Settings → General → Project Kind has "Initialize Git…", "Switch to
  git project" and "Convert to plain project".

## Initialize Git

`projects/git_init.rs`:

- `inspect_git_init_folder(path)` → `GitInitPreview`: file count and size the
  first commit would add (honoring the folder's `.gitignore`, or the default
  one), whether a `.gitignore` exists, and `sync_provider`.
- `sync_folder_provider(path)` detects iCloud Drive (`~/Library/Mobile
Documents`, `iCloudDrive`), Dropbox, OneDrive and Google Drive from the
  path alone, also `~/Library/CloudStorage/<Provider>-*`. These services sync
  `.git` file by file and can corrupt the repository across two machines.
- `init_git_in_folder(path, commitAll)`: `git init`, writes
  `DEFAULT_GITIGNORE` when there is no `.gitignore`, then commits all files
  or, with `commitAll: false`, makes an empty initial commit. Clients that
  send no `commitAll` keep the old behavior (commit all).
