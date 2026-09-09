# Changelog

All notable changes to Jean are recorded in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Title bar: a Usage button that shows plan limits in place.** Plan limits for
  Claude, Codex and Grok were only visible in Settings → Usage, which covers the
  whole app for a glance at a percentage. A chart button now sits in the left
  title bar, after Settings, and opens the same pane in a popover under it.
  - The popover shows every installed and signed-in backend, with the same
    progress bars, plan names, reset times and Refresh button as the Settings
    pane.
  - A "Settings" button in its header opens Settings on the Usage pane, for the
    times you want the full-height view.
  - The usage figures load only while the popover is open, and they are shared
    with the dock's usage badge, so opening it asks the backends for nothing
    they were not already asked.
  - The dock usage dropdown is unchanged. It follows the active session, while
    the title bar button is always in reach.

- **Files sidebar: a context menu on file and folder rows.** A row could only
  be left-clicked into Jean's internal viewer. A right-click now gives Open,
  Open in your editor, Open in Default App, Reveal in Finder, Open in Terminal
  (folders only), Add to Chat, Copy Path and Copy Relative Path.
  - "Reveal in Finder" selects the target inside its parent folder. Windows
    shows it in Explorer. Linux opens the parent folder, because it has no
    portable flag to select a file.
  - "Open in Default App" hands the file to the application the operating
    system has registered for it, so images and PDFs no longer open in a code
    editor.
  - "Add to Chat" puts the row into the composer as an `@mention` and attaches
    the file, the same as the `@` popover does.
  - Items that need a host shell are hidden in web access. Open, Add to Chat
    and the two copy items stay available.

### Added

- **Global search: Sessions and Projects each get their own tab.** CMD+K had
  Quick and Search messages only, so sessions, projects, connections and every
  static command shared one list. Quick caps the sessions at eight and the rest
  is mixed in with commands, so the row you wanted was often truncated away or
  buried.
  - The **Sessions** tab lists every session across every project, newest
    activity first, with no cap and no commands mixed in. Unlike Quick it also
    lists the session you already have open.
  - The **Projects** tab lists every project, most recently opened first.
  - Both use the same rows Quick uses — backend icon, status, "time ago" for
    sessions; avatar and label for projects — and both filter the loaded data
    as you type. Only "Search messages" still asks the backend.
  - Tab cycles all four tabs and Shift+Tab cycles back; it used to flip
    between two. Clicking a tab still works, which is the route on mobile, and
    the tab strip wraps rather than squeezing in a narrow window.
  - The placeholder and the empty state name the tab you are in.
  - Opening a session from either tab goes through the same navigation as
    everywhere else, so the sidebar follows the jump.

### Changed

- **Session context menu: "Set Status" is now "Status."** The verb added
  nothing next to the neighbouring rows.

- **The sidebar now follows a command-palette jump.** Opening a session with
  CMD+K moved the main area but left the tree behind: the previous selection
  stayed highlighted, the target's project and workspace could still be
  collapsed, and a row further down the list was never scrolled to. You saw a
  session with no idea where it lived.
  - Every programmatic jump — the palette, the unread bell, the Home view —
    now selects the target workspace, opens the folders above the project, the
    project itself and the workspace, and scrolls the session row into view.
  - The scroll uses `block: 'nearest'`, so a row already on screen does not
    move, and it follows the system "reduce motion" setting.
  - One reveal per jump. Scrolling away afterwards is never undone.
  - Picking a project in the palette opens the folders above it and scrolls to
    its row. The project's own subtree is left as you had it.
  - The mobile drawer gets the same behavior, since it renders the same tree.

- **Sidebar: the "Pinned" block is now a tree row like any other.** Its parent
  was a small uppercase caption, so it broke the alignment of the workspace
  rows directly below it, and its sessions were indented differently from
  ordinary session rows.
  - The parent takes the workspace row's geometry — the same height, padding,
    indent (including the narrow-sidebar indent) and full-width hover.
  - It expands and collapses with the same chevron as a workspace row, and
    that expansion is remembered across restarts, per project.
  - While collapsed it carries the same count badge a collapsed workspace row
    carries.
  - The pinned sessions now match session rows exactly, and the bespoke
    separator line under the block is gone — spacing comes from being a row.
  - The row is a button, so Enter and Space open and close it. It still stays
    out of the canvas keyboard index, which counts workspace sections.
  - The canvas variant of the block is untouched.

### Fixed

- **Context menus: submenu rows now match the rows above and below them.** The
  "Status" and "Labels" rows in the session context menu are submenu triggers,
  not plain menu items, and the shared `ContextMenuSubTrigger` was missing the
  icon and spacing rules that `ContextMenuItem` carries. Their icons stayed at
  full foreground colour while every sibling icon was faded, and their text sat
  8px to the left of the text on every other row.
  - The sub-trigger now uses the same `gap-2`, faded-icon and icon-size rules
    as a menu item, so the labels line up and the icons share one tone.
  - The chevron on the right is now faded as well, to match the leading icons.
  - The "Run" submenu on a worktree with several run scripts is corrected by
    the same change.

- **macOS stops re-asking JeanZ for access to other apps' data.** JeanZ shipped
  the stable `com.jean.desktop` bundle identifier, but it is signed by a
  different Developer ID team than Jean. macOS records a privacy grant against
  the bundle identifier *and* the code signature it saw, so each app failed the
  requirement the other had stored: the dialog "JeanZ.app would like to access
  data from other apps" came back on every launch, and allowing it invalidated
  stable Jean's grant in turn.
  - JeanZ now ships `com.jean.desktop.jeanz`. Each app gets its own privacy
    record, so one grant sticks.
  - The data stays shared. The desktop app no longer takes its data directory
    from the bundle identifier — it calls `jean_core::resolve_data_dir()`,
    which returns the platform data directory plus a constant. Projects,
    sessions, worktrees, preferences and CLI logins are untouched, and no
    install has to migrate.
  - `JEAN_DATA_DIR` now also overrides that directory for the desktop app, not
    only for the headless host, which is how an isolated profile is made.
  - Project avatars and pasted images keep loading: the asset protocol scope
    follows the identifier, so the shared directory is granted by its real path
    at startup.
  - Two one-time effects on the first JeanZ start after this change. Settings
    kept in the WebView (zoom, client preferences, the remote-connection list)
    start empty, and the files Tauri plugins own move with the identifier — the
    window-state file, the persisted file scope and the log directory. Jean's
    own window layout lives in `ui-state_jeanz.json` and is unaffected.
  - A locally built JeanZ is ad-hoc signed, so its code hash changes on every
    build and no grant can stick for it. Only a Developer ID build has a stable
    identity.

- **Sidebar: the scrollbar no longer covers the session timestamp.** A session
  row carried left padding only, so its "time ago" text ended flush with the
  sidebar edge and the scrollbar thumb was drawn on top of it once the list
  grew long enough to scroll.
  - The session row now keeps the same `pr-2` as the workspace row above it,
    so both end at the same place.
  - The tree's scroll container reserves a lane for the scrollbar
    (`scrollbar-gutter: stable`), so nothing is drawn over the row and the
    tree no longer shifts sideways the moment the list starts to overflow.

- **Project canvas: labels you created but assigned to nobody now survive a
  restart.** The canvas keeps a per-project label registry so a label stays in
  the picker after you take it off the last worktree. The frontend wrote that
  registry into `project_canvas_settings.<project>.labels`, but the Rust
  `ProjectCanvasSettings` struct had no such field, and serde drops unknown
  fields — so every save discarded it.
  - A label you created and then unassigned disappeared from the picker on the
    next start, and a colour change was lost with it. The registry rebuilt
    itself from the labels still on worktrees, which made the loss look like
    the label had never been created.
  - Rust now carries `labels` next to `pinned_labels`, with the same
    `#[serde(default)]` and empty-list skip, so old state files still load and
    a project without labels writes no extra key.
  - Pinned labels were never affected; they always had a Rust field.

- **JeanZ keeps its own UI state, so stable Jean can no longer erase it.** JeanZ
  shares one app-data directory with stable Jean on purpose, so both builds
  read and write the same files. They do not share a `UIState` schema: a build
  that does not know a field drops that field when it saves, which silently
  deleted the newer build's state. Workspace expansion, added in JeanZ first,
  disappeared on every restart for anyone who also ran stable Jean.
  - JeanZ now uses `ui-state_jeanz.json`; stable Jean keeps `ui-state.json`.
  - On its first start JeanZ reads the shared file once, so the window layout,
    drafts and expansion carry over. Every later save goes to the JeanZ file.
  - The flavor is recognised from the build config and from the `.app` bundle
    name, so both signals must miss before a JeanZ build is read as stable Jean.
  - Projects, sessions, preferences and CLI logins are still shared, which is
    the point of the shared directory.

- **Sidebar: "Completed" and "Cancelled" session statuses now change the row.**
  Setting a session to Completed had no visible effect, and Cancelled did not
  move the row out of the Review section. Three causes were corrected:
  - Completed shared the green indicator with "Review ready". It now has its own
    light-blue dot, in the sidebar as well as in the unread bell and the command
    palette.
  - Completed, Cancelled, Review and Crashed all shared one "Review" section.
    Completed and Cancelled each get their own sidebar section now. Crashed stays
    under Review, because it still needs attention.
  - A pinned Completed or Cancelled status was discarded while a session waited
    for a plan approval or an answer, so the pin did nothing. A pinned terminal
    status now wins over a waiting status. It still does not hide a run that is
    in flight, scheduled, or crashed.
