# Vertical navigation (draft)

Open `index.html` in a browser. It is a clickable draft with sample data.

## Layout

- **Vertical nav (rail)** left of the sidebar: Home, then the sidebar tabs
  (Projects, Recent, Starred, To-Do | Agents, Graphs), then Scheduled and
  Archived (pages in the main area; their rows leave the Projects panel).
  Collapse/expand button at the bottom of the nav. Collapsed: icons only, tooltips, count badges on
  Starred, Agents, To-Do (blue: waiting for you) and Graphs.
- **Panel (secondary sidebar)** next to the nav shows the selected tab's list.
  The tab strip in today's sidebar goes away.
- **Sidebar footer**: today's footer, unchanged in items and design (Settings,
  Server connections, Usage | Updates, unread bell, "…"). It spans the nav and
  the panel.
- **Title bar**: the macOS window controls never move. The strip above the nav
  and panel holds only the window controls. The hide/show sidebar button moves
  into the main header, in front of back/forward.
- **Home**: no panel, no title-bar side area, no sidebar button. One plain top
  bar (window controls, back/forward, title). The sidebar footer shrinks to the
  width of its icons (12 px spacer between the left and right groups); a Home
  footer in the same design fills the rest, with stats on the right.
