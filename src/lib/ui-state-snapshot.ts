import { useProjectsStore } from '@/store/projects-store'
import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'
import { useTerminalStore } from '@/store/terminal-store'
import { useBrowserStore } from '@/store/browser-store'
import { isLocalBackend } from '@/lib/environment'
import type { PendingImage, PendingTextFile } from '@/types/chat'
import type {
  PendingImageDraft,
  PendingTextFileDraft,
  UIState,
} from '@/types/ui-state'

/** Serialize ready (non-loading) pending images for UI-state persistence. */
function serializePendingImages(
  pendingImages: Record<string, PendingImage[]>
): Record<string, PendingImageDraft[]> {
  const out: Record<string, PendingImageDraft[]> = {}
  for (const [sessionId, images] of Object.entries(pendingImages)) {
    const ready = images.flatMap(img =>
      !img.loading && img.path
        ? [{ id: img.id, path: img.path, filename: img.filename }]
        : []
    )
    if (ready.length > 0) {
      out[sessionId] = ready
    }
  }
  return out
}

/**
 * Serialize pending text-file attachments without embedding full content,
 * so large pastes do not bloat the UI-state JSON.
 */
function serializePendingTextFiles(
  pendingTextFiles: Record<string, PendingTextFile[]>
): Record<string, PendingTextFileDraft[]> {
  const out: Record<string, PendingTextFileDraft[]> = {}
  for (const [sessionId, textFiles] of Object.entries(pendingTextFiles)) {
    if (textFiles.length === 0) continue
    out[sessionId] = textFiles.map(({ id, path, filename, size }) => ({
      id,
      path,
      filename,
      size,
    }))
  }
  return out
}

/**
 * Build the UI-state blob from the current store values.
 *
 * NOTE: Durable session-specific state is stored in Session files. Unsent
 * input drafts (text + image/text-file attachments) remain lightweight UI
 * state so they survive full UI reloads.
 *
 * Lives outside the persistence hook because it reads stores only: the
 * immediate save path (`@/lib/ui-state-flush`) needs the same snapshot
 * without rendering a component.
 */
export function getCurrentUIState(): UIState {
  const {
    activeWorktreeId,
    activeWorktreePath,
    lastActiveWorktreeId,
    activeSessionIds,
    inputDrafts,
    pendingImages,
    pendingTextFiles,
    pendingFiles,
    pendingSkills,
    dismissedSetupScripts,
    reviewSidebarVisible,
    lastOpenedPerProject,
  } = useChatStore.getState()
  const {
    expandedProjectIds,
    expandedFolderIds,
    expandedWorktreeIds,
    expandedPinnedProjectIds,
    starredSessions,
    starredSectionCollapsed,
    projectRailHidden,
    selectedProjectId,
    projectAccessTimestamps,
    dashboardWorktreeCollapseOverrides,
    projectCanvasSettings,
    githubDashboardFavoriteProjectIds,
  } = useProjectsStore.getState()
  const {
    leftSidebarSize,
    leftSidebarVisible,
    fileBrowserSize,
    fileBrowserVisible,
    zenMode,
    sessionTerminalIds,
    sessionPrimarySurface,
    seenFailedWorkflowRunIds,
    mobileActiveTab,
  } = useUIStore.getState()
  const {
    terminals,
    activeTerminalIds,
    terminalPanelOpen,
    terminalVisible,
    terminalHeight,
    modalTerminalOpen,
    modalTerminalDockMode,
    modalTerminalWidth,
    modalTerminalHeight,
  } = useTerminalStore.getState()
  const shouldPersistTerminalRuntime = !isLocalBackend()
  const terminalInstancesForPersist = shouldPersistTerminalRuntime
    ? Object.fromEntries(
        Object.entries(terminals).flatMap(([worktreeId, list]) => {
          if (list.length === 0) return []
          return [
            [
              worktreeId,
              list.map(terminal => ({
                id: terminal.id,
                command: terminal.command,
                command_args: terminal.commandArgs ?? null,
                label: terminal.label,
                kind: terminal.kind ?? 'panel',
                session_id: terminal.sessionId,
              })),
            ] as const,
          ]
        })
      )
    : {}
  const browserState = useBrowserStore.getState()
  const browserTabsForPersist = Object.fromEntries(
    Object.entries(browserState.tabs).map(([wid, list]) => [
      wid,
      list.map(t => ({ id: t.id, url: t.url, title: t.title || undefined })),
    ])
  )

  return {
    active_worktree_id: activeWorktreeId,
    active_worktree_path: activeWorktreePath,
    last_active_worktree_id: lastActiveWorktreeId,
    active_project_id: selectedProjectId,
    expanded_project_ids: Array.from(expandedProjectIds),
    expanded_folder_ids: Array.from(expandedFolderIds),
    expanded_worktree_ids: Array.from(expandedWorktreeIds),
    expanded_pinned_project_ids: Array.from(expandedPinnedProjectIds),
    starred_sessions: starredSessions.map(star => ({
      project_id: star.projectId,
      worktree_id: star.worktreeId,
      session_id: star.sessionId,
    })),
    starred_sessions_collapsed: starredSectionCollapsed,
    project_rail_hidden: projectRailHidden,
    mobile_active_tab: mobileActiveTab,
    left_sidebar_size: leftSidebarSize,
    left_sidebar_visible: leftSidebarVisible,
    file_browser_size: fileBrowserSize,
    file_browser_visible: fileBrowserVisible,
    zen_mode: zenMode,
    active_session_ids: activeSessionIds,
    input_drafts: inputDrafts,
    pending_images: serializePendingImages(pendingImages),
    pending_text_files: serializePendingTextFiles(pendingTextFiles),
    pending_files: Object.fromEntries(
      Object.entries(pendingFiles).map(([sessionId, files]) => [
        sessionId,
        files.map(file => ({
          id: file.id,
          relative_path: file.relativePath,
          source_root_path: file.sourceRootPath,
          source_project_id: file.sourceProjectId,
          source_project_name: file.sourceProjectName,
          extension: file.extension,
          is_directory: file.isDirectory,
        })),
      ])
    ),
    pending_skills: pendingSkills,
    dismissed_setup_scripts: Object.keys(dismissedSetupScripts),
    // Review sidebar visibility
    review_sidebar_visible: reviewSidebarVisible,
    // Modal terminal drawer state
    modal_terminal_open: modalTerminalOpen,
    modal_terminal_dock_mode: modalTerminalDockMode,
    modal_terminal_width: modalTerminalWidth,
    modal_terminal_height: modalTerminalHeight,
    // Terminal runtime state (web access only; native app restart must not auto-spawn old shells)
    terminal_instances: terminalInstancesForPersist,
    terminal_active_ids: shouldPersistTerminalRuntime ? activeTerminalIds : {},
    terminal_panel_open: shouldPersistTerminalRuntime ? terminalPanelOpen : {},
    terminal_visible: shouldPersistTerminalRuntime ? terminalVisible : false,
    terminal_height: shouldPersistTerminalRuntime ? terminalHeight : 30,
    session_terminal_ids: shouldPersistTerminalRuntime
      ? sessionTerminalIds
      : {},
    session_primary_surface: shouldPersistTerminalRuntime
      ? sessionPrimarySurface
      : {},
    // Browser pane state (per-worktree tabs + 3-surface visibility)
    browser_tabs: browserTabsForPersist,
    browser_active_tab_ids: browserState.activeTabIds,
    browser_side_pane_open: browserState.sidePaneOpen,
    browser_side_pane_width: browserState.sidePaneWidth,
    browser_modal_open: browserState.modalOpen,
    browser_modal_dock_mode: browserState.modalDockMode,
    browser_modal_width: browserState.modalWidth,
    browser_modal_height: browserState.modalHeight,
    browser_bottom_panel_open: browserState.bottomPanelOpen,
    browser_bottom_panel_height: browserState.bottomPanelHeight,
    // Project access timestamps for recency sorting
    project_access_timestamps: projectAccessTimestamps,
    // Dashboard worktree collapse overrides
    dashboard_worktree_collapse_overrides: dashboardWorktreeCollapseOverrides,
    // Project canvas settings per project
    project_canvas_settings: Object.fromEntries(
      Object.entries(projectCanvasSettings).map(([projectId, settings]) => [
        projectId,
        {
          worktree_sort_mode: settings.worktreeSortMode,
          pinned_labels: settings.pinnedLabels,
          labels: settings.labels,
          pinned_sessions: settings.pinnedSessions?.map(pin => ({
            session_id: pin.sessionId,
            worktree_id: pin.worktreeId,
          })),
          session_sort_mode: settings.sessionSortMode,
          session_sort_direction: settings.sessionSortDirection,
        },
      ])
    ),
    github_dashboard_favorite_project_ids: githubDashboardFavoriteProjectIds,
    // Last opened worktree+session per project (convert camelCase → snake_case keys)
    last_opened_per_project: Object.fromEntries(
      Object.entries(lastOpenedPerProject).map(([projectId, entry]) => [
        projectId,
        { worktree_id: entry.worktreeId, session_id: entry.sessionId },
      ])
    ),
    seen_failed_workflow_run_ids: seenFailedWorkflowRunIds,
    version: 1, // Reset for first release
  }
}
