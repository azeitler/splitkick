import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'

/**
 * Show one schedule (#38) in the main area: its settings and its runs.
 * Opened from the sidebar's Scheduled tab. Like a graph and the Archived
 * view, it is a state with no project and no worktree selected, so it clears
 * both first. Selecting anything afterwards closes it again (see
 * `MainWindowContent`).
 */
export function openScheduleView(scheduleId: string): void {
  useProjectsStore.getState().selectProject(null)
  useChatStore.getState().clearActiveWorktree()
  const ui = useUIStore.getState()
  ui.setActiveGraphId(null)
  ui.setArchivedViewOpen(false)
  ui.setActiveScheduleId(scheduleId)
}
