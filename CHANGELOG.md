# Changelog

All notable changes to Jean are recorded in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.73-z.4] - 2026-09-10

Built on Jean 0.1.73. JeanZ versions carry a `-z.<n>` suffix; the counter is
this fork's own and never restarts.

### Added

- **A Home view collects recent sessions and an activity log.** Jean opened on
  the last thing you had selected, so picking work back up after a break meant
  walking the sidebar project by project to find what had moved.
  - **Recent sessions** lists the sessions you touched last, newest first,
    across every project, with the status dot and the labels each row carries
    in the sidebar. Click one to open it.
  - **Recent activity** is a history feed rather than a to-do list: runs that
    finished, were cancelled or crashed, commits, pull requests opened, merged
    and closed, and finished AI code reviews. A row that has a URL, such as a
    pull request, opens it; the rest jump to the session.
  - The log holds the newest 500 records and is trimmed in place, so it never
    grows without a bound.

- **An agent can mark its own session complete.** The MCP tool
  `set_session_status` takes `completed`, so an agent that has finished its work
  takes the session off Jean's attention list itself, instead of leaving it for
  you to clear by hand. Omit `sessionId` and it targets the calling session.
  Live states — running, waiting for input, plan approval, crashed — still win
  while the session is active; the manual status shows once it goes idle.

- **JeanZ inherits stable Jean's look and client settings on its first start.**
  Jean's own data — projects, sessions, worktrees, preferences, CLI logins —
  is shared by path and was never at risk. Two stores sit outside that
  directory and follow the bundle identifier instead, so a JeanZ build with its
  own identifier would have started with both of them empty.
  - The WebView store carries the theme, the zoom level, the client
    preferences, the cached model catalog and the remote-connection list. The
    whole store is copied, so cookies and IndexedDB come along too. The
    per-origin directories inside it are named from the page origin and a salt
    that travels with the tree, so the copy lands where the new WebView looks.
  - The Tauri plugin state beside the data directory is copied as well: the
    window geometry and the persisted file scope.
  - It happens once. A later start never overwrites what JeanZ has since
    written, and a copy that fails part way leaves nothing behind, so the next
    start tries again instead of treating a half-copy as finished.
  - Every step is best effort. A failure leaves JeanZ with the empty state it
    would have had anyway and never stops it from starting.

- **Pinned sessions get the same context menu as every other session row.** A
  right-click on a pinned row offered one item, "Unpin from Project", while the
  identical session under its workspace offered the full menu. Renaming or
  archiving a pinned session meant finding it again somewhere else.
  - The pinned row now carries the shared session menu: open, rename, status,
    labels, pin/unpin, archive and delete.
  - Rename works inline on the row, exactly as it does in the tree.
  - Delete follows the removal preference, so it archives unless you have set
    it to delete for real.
  - Pinned rows come from several workspaces at once, so rename and removal
    now take their target per call. Rows that all share one workspace keep the
    simpler bound handlers.
  - Pinned rows still stay out of the canvas keyboard navigation, which counts
    workspace sections.

- **Remote connections: a login proxy is named instead of retried forever.** A
  remote Jean server behind an SSO proxy such as Cloudflare Access, Authelia,
  Authentik, Google IAP or oauth2-proxy left the desktop app reconnecting every
  ten seconds with no explanation.
  - The desktop app genuinely cannot sign in to one. Its page origin is
    `tauri://localhost`, so every call to the remote host is cross-origin and
    carries no cookies, and a WebView cannot put headers or cookies on a
    WebSocket handshake at all. A browser can, because there the page and the
    socket share the proxy's origin.
  - Jean now recognises the proxy: a real Jean server always answers
    `/api/auth` with JSON, for 200 and for 401 alike, so an HTML body or a
    redirect to another origin means something else replied.
  - The message says what to do — reach the server over a private network such
    as Cloudflare One/WARP or Tailscale, or open the URL in a browser, where
    the login works.
  - The ten-second auto-retry stops for this failure, since no retry can fix
    it. The manual Retry button stays.
  - Adding or editing such a connection is blocked while you are still in the
    dialog, next to an invalid token. Every other probe failure stays
    non-blocking, so a server that is merely offline can still be saved.
  - Browser web access is exempt: there the proxy's own session cookie works.

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

- **A session that finishes a run is Review, not Completed.** Sessions skipped
  the review state and landed in Completed on their own, so "Completed" said
  nothing about whether anyone had looked at the work.
  - A run that ends cleanly now reports as **Review ready**. `completed` is a
    manual status only: you pin it from the Set Status menu, or an agent pins it
    for its own session through the MCP `set_session_status` tool.
  - The unread bell and the command palette follow the same rule. They read
    "Review ready" for a finished run and keep the light-blue "Completed" for a
    pinned one.
  - A pinned Completed no longer counts toward a worktree's review tally on the
    project canvas, and no longer pulls the worktree summary back to review. You
    marked it done, so it is done.
  - `cancelled`, `crashed` and the live states are untouched.

- **The base session carries a "Base Session" badge everywhere.** A base
  session is named after the default branch, so the sidebar listed it as an
  ordinary workspace called `main`, while the project canvas dropped the name
  and printed `Base Session` in its place. The same session went by two names,
  and neither surface told you what the other one meant.
  - Both now show the branch name followed by the same small **Base Session**
    pill. The sidebar drops the pill below 200px of width, where the row has no
    room, the way it already drops the last-active time and the labels.
  - Screen readers keep the wording: the canvas row and its drag handle read
    "Open main (Base Session)" and "Reorder main (Base Session)".

- **Session context menu: "Set Status" is now "Status."** The verb added
  nothing next to the neighbouring rows.

- **Sidebar: a row fades after two days, not seven.** A finished session six
  days old still rendered at full weight, long past the point where it is
  worth scanning. The threshold is now 48 hours, which lines up with the age
  label: everything reading "2d ago" or older is faded, everything reading
  "1d ago" or newer is not.

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

- **The development build no longer writes to the installed app's data.** The
  data directory stopped following the bundle identifier so that JeanZ and
  stable Jean could share one set of projects, sessions and CLI logins. That
  swept in `bun run tauri dev`, which had always had its own profile: a debug
  run read and wrote the real data and raced the installed app over the same
  unlocked JSON files.
  - The development identifier is now the one build held apart. Release flavors
    such as JeanZ still share stable Jean's directory, which is the point.
  - `JEAN_DATA_DIR` still overrides both, for an isolated profile.
  - First-start seeding is held apart the same way. The development build had
    counted as a flavor, so its first launch copied stable Jean's WebView
    store — which holds the remote-connection list, access tokens included —
    into its own.

- **The activity feed keeps one row per session instead of one per turn.** A
  run is one chat turn, not one session, so a long session appended "Session
  finished" on every turn and pushed the commits, pull requests and reviews the
  feed exists to show out of the 500-record log within an afternoon.
  - A session now holds a single row, carrying its latest outcome. A session
    that finished and was then cancelled reads as cancelled, not both.
  - Records that share one second are no longer returned oldest-first. A commit
    and the pull request opened from it are written in the same second, and the
    feed had shown them in reverse.

- **A server behind TLS is no longer mistaken for an SSO login proxy.** The
  check treated any redirect that left the origin as a login proxy, and a
  redirect from `http://host:8080` to `https://host:8080` leaves the origin.
  A healthy server entered over `http://` was therefore reported as sitting
  behind a proxy, and — because that verdict blocks saving — could not be added
  at all.
  - The host is compared now, not the whole origin. A real login proxy answers
    from another host, such as `team.cloudflareaccess.com`. A scheme or port
    change on the same host is an ordinary redirect.

- **Sidebar: a stale row fades after two days, not a week.** The fade is meant
  to point at work that has gone quiet, and at seven days almost nothing ever
  reached it.

- **Sidebar: a project row no longer collapses on a click.** Clicking a
  workspace row left its open/closed state alone — only the chevron changed it
  — but clicking a project row expanded or collapsed the project. The two row
  types look the same and sit in the same tree, so the same click gave two
  different results, and a project collapsed by accident whenever you only
  meant to click the row.
  - A click on a project row now opens the project canvas, whether the project
    has workspaces or not. It was the behavior of an empty project already, and
    a project that has workspaces had no row to click its way in.
  - The chevron is the only control for expand and collapse, for projects and
    for workspaces alike. Double-click to rename and the context menu are
    unchanged.

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
  the bundle identifier _and_ the code signature it saw, so each app failed the
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
  - Nothing is lost in the move. On its first start JeanZ copies stable Jean's
    WebView store and plugin state across, so it opens looking exactly like the
    app it was built from — same theme, same zoom, same client preferences,
    same remote connections, same window geometry. Only the log directory is
    left behind, which nobody misses.
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

## [0.1.73-z.3] - 2026-09-09

Built on Jean 0.1.73.

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

### Fixed

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

[unreleased]: https://github.com/azeitler/jean/compare/v0.1.73-z.4...HEAD
[0.1.73-z.4]: https://github.com/azeitler/jean/compare/v0.1.73-z.3...v0.1.73-z.4
[0.1.73-z.3]: https://github.com/azeitler/jean/compare/v0.1.73-z.2...v0.1.73-z.3
