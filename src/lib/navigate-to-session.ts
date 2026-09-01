import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'

export interface SessionNavigationTarget {
  projectId: string
  worktreeId: string
  sessionId: string
}

/**
 * Open a session from anywhere in the app, including from a different project.
 *
 * Shared by the unread bell and the command palette. The target project's
 * canvas may not be mounted yet, so the auto-open is queued through the UI
 * store rather than dispatched as a DOM event.
 */
export function navigateToSession(target: SessionNavigationTarget): void {
  const { selectedProjectId, selectProject } = useProjectsStore.getState()
  const { setActiveSession, clearActiveWorktree, setLastOpenedForProject } =
    useChatStore.getState()

  if (selectedProjectId !== target.projectId) {
    selectProject(target.projectId)
  }

  // Navigate to ProjectCanvasView (no-op if already there)
  clearActiveWorktree()
  setActiveSession(target.worktreeId, target.sessionId, { markOpened: false })
  setLastOpenedForProject(target.projectId, target.worktreeId, target.sessionId)

  // Queue auto-open via store so it survives lazy-mount + Suspense + remount.
  // ProjectCanvasView consumes pendingAutoOpenSessionIds in its own effect.
  useUIStore
    .getState()
    .markWorktreeForAutoOpenSession(target.worktreeId, target.sessionId)
}
