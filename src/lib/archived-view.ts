import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'

/**
 * Show the Archived view in the main area, filtered to `projectId` when one
 * is given (a project's Archived row in the sidebar), else to all projects.
 *
 * Like Home, it is a state with no project and no worktree selected, so it
 * clears both first. Selecting anything afterwards closes the view again
 * (see `MainWindowContent`).
 */
export function openArchivedView(projectId: string | null = null): void {
  useProjectsStore.getState().selectProject(null)
  useChatStore.getState().clearActiveWorktree()
  const ui = useUIStore.getState()
  ui.setActiveGraphId(null)
  ui.setScheduledViewOpen(false)
  ui.setArchivedViewProjectId(projectId)
  ui.setArchivedViewOpen(true)
}

/** Detail of the `command:open-archived-modal` event (`MainWindow`). */
export interface OpenArchivedDetail {
  projectId?: string
}
