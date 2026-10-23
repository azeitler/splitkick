import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'

/**
 * Show the Archived view in the main area.
 *
 * Like Home, it is a state with no project and no worktree selected, so it
 * clears both first. Selecting anything afterwards closes the view again
 * (see `MainWindowContent`).
 */
export function openArchivedView(): void {
  useProjectsStore.getState().selectProject(null)
  useChatStore.getState().clearActiveWorktree()
  useUIStore.getState().setArchivedViewOpen(true)
}
