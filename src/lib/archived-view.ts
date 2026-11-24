import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'

/**
 * Show the Archived view in the main area, filtered to `projectId` when one
 * is given, else to all projects. The sidebar switches to its Archived tab,
 * where the project's row shows as selected; it comes back if it was hidden.
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
  ui.setActiveScheduleId(null)
  ui.setArchivedViewProjectId(projectId)
  ui.setArchivedViewOpen(true)
  ui.setSidebarTab('archived')
  if (!ui.leftSidebarVisible) ui.setLeftSidebarVisible(true)
}

/** Detail of the `command:open-archived-modal` event (`MainWindow`). */
export interface OpenArchivedDetail {
  projectId?: string
}
