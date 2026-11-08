import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'

/**
 * Show the Scheduled view (#38) in the main area: every schedule across
 * projects. Like Home and the Archived view, it is a state with no project
 * and no worktree selected, so it clears both first. Selecting anything
 * afterwards closes the view again (see `MainWindowContent`).
 */
export function openScheduledView(): void {
  useProjectsStore.getState().selectProject(null)
  useChatStore.getState().clearActiveWorktree()
  const ui = useUIStore.getState()
  ui.setActiveGraphId(null)
  ui.setArchivedViewOpen(false)
  ui.setScheduledViewOpen(true)
}
