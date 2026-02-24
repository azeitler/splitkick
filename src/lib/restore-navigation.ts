import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'

/**
 * Check if the user is currently on a canvas view (project or worktree canvas).
 * Returns false if on chat view (restore is not allowed from chat view).
 */
export function isOnCanvasView(): boolean {
  const { activeWorktreeId, activeWorktreePath, viewingCanvasTab } =
    useChatStore.getState()
  const { selectedProjectId } = useProjectsStore.getState()

  if (!activeWorktreePath) {
    // No active worktree → on project canvas if a project is selected
    return !!selectedProjectId
  }

  // Active worktree → check if viewing canvas tab (default true)
  return viewingCanvasTab[activeWorktreeId ?? ''] ?? true
}

/**
 * Navigate to a restored item on canvas, handling view-aware preselection.
 *
 * - Project canvas → stays on project canvas (auto-selection picks up restored item)
 * - Same worktree canvas → ensures canvas tab is shown
 * - Different worktree → switches to that worktree's canvas
 *
 * If sessionId is provided, preselects that session on canvas.
 */
export function navigateToRestoredItem(
  worktreeId: string,
  worktreePath: string,
  sessionId?: string
): void {
  const {
    activeWorktreeId,
    activeWorktreePath,
    setActiveWorktree,
    setActiveSession,
    setCanvasSelectedSession,
    setViewingCanvasTab,
  } = useChatStore.getState()
  const { selectedProjectId, selectWorktree } = useProjectsStore.getState()

  // Preselect the session if provided
  if (sessionId) {
    setActiveSession(worktreeId, sessionId)
    setCanvasSelectedSession(worktreeId, sessionId)
  }

  if (!activeWorktreePath && selectedProjectId) {
    // On project canvas → stay (auto-selection picks up new data after query invalidation)
    return
  }

  if (activeWorktreeId === worktreeId) {
    // Same worktree canvas → ensure canvas tab is shown
    setViewingCanvasTab(worktreeId, true)
  } else {
    // Different worktree or no active worktree → navigate to restored worktree canvas
    selectWorktree(worktreeId)
    setActiveWorktree(worktreeId, worktreePath)
    setViewingCanvasTab(worktreeId, true)
  }
}
