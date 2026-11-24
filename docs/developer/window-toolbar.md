# Window Toolbar (desktop)

Desktop window chrome follows the macOS unified toolbar: the sidebar runs to
the top edge, and a 52pt toolbar sits above the main column. Design and
decisions: `docs/superpowers/specs/2026-10-14-unified-toolbar-design.md`.

```
title strip (traffic lights, app only)  │ WindowToolbar (toggle ‹ › title chips … actions search)
VerticalNav │ ProjectsSidebar (panel)   │ side panel   │ view content
SidebarFooter (settings, usage, …)      │              │
```

- `src/components/toolbar/WindowToolbar.tsx`: the bar. Owns Back/Forward, the
  file browser toggle (opens the side panel on Files, see `context-panel.md`), the sidebar toggle and traffic-light inset when the
  sidebar is hidden, the zen variant, Linux window controls, drag regions.
- `src/components/sidebar/SidebarFooter.tsx`: app-level
  items (Settings, Connections, Usage, Updates, Unread, ⋯ GitHub/Sponsor/
  release notes).
- `src/components/titlebar/TitleBar.tsx`: phone bar only (zen).
- Height: `--titlebar-height` in `App.css` (52pt desktop). Traffic lights are
  centred with `trafficLightPosition` (`tauri*.conf.json`) and
  `traffic_light_position` (`connection_window.rs`) — keep the three in step.

## Filling the toolbar from a view

```tsx
const hasToolbar = useHasWindowToolbar() // false on a phone
return hasToolbar ? (
  <ToolbarContent
    title={project.name}
    subtitle="4 worktrees"
    chips={<Badges />}
    actions={<OpenInButton … />}
    search={<ToolbarFilterSearch value={q} onChange={setQ} placeholder="Filter" />}
  />
) : (
  <OwnHeader />
)
```

- Content goes in through portals: the view keeps its state and handlers.
- The newest `ToolbarContent` owns the bar (session modal over the canvas);
  when it unmounts the previous one shows again. No owner → window title.
- Search: `ToolbarFilterSearch` filters the view; `ToolbarPaletteSearch` opens
  the command palette.
- Narrow toolbar (container queries on the bar): below 1000px text labels
  marked `data-toolbar-label` hide; below 720px the palette search becomes an
  icon and the filter field narrows; below 620px chips hide; below 520px the
  subtitle hides.
- React must not render children into a slot element: the slots stay empty
  for their portals (see the fallback title in `WindowToolbar`).

## Vertical navigation

The desktop layout, in the app and in web access, is
`components/layout/vertical-nav/VerticalNavLayout.tsx`. There is no setting
and no other desktop layout: `MainWindow` uses it whenever `useIsMobile()` is
false. Phones have their own tabs (`docs/developer/mobile-layout.md`). In a
browser the sidebar column has no title strip (no window controls).

- `ProjectsSidebar` is only the panel: the list of the selected tab. Home,
  the tabs, Scheduled and Archived are nav items (`TAB_META` and the counts in
  `vertical-nav/tab-meta.tsx`, `openHome` in `vertical-nav/home-nav.ts`).
  Opt-in props: `SidebarFooter compact` (Home), `WindowToolbar
  trafficLightInset / sidebarToggle`.
- Home (`useIsHomeNavActive`) shows no panel: the toolbar spans the window,
  the nav sits below it, the footer row holds the compact sidebar footer and
  `HomeFooter`. A tab picked on Home shows its panel next to Home (local
  state, reset when Home closes).
- The main content keeps one place in the tree in every state, so a switch
  between Home and a tab does not remount chats, terminals or browser panes.
- The collapsed nav is UI state (`vertical_nav_collapsed`).
- Spec and clickable draft: `docs/mockups/vertical-nav/`.
