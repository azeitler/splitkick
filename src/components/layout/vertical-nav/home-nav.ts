import { useIsHomeActive } from '@/components/home/useIsHomeActive'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'

/** Whether the Home view shows: Home, and no Archived, graph or schedule
 *  page over it. The vertical navigation marks its Home item with it. */
export function useIsHomeNavActive(): boolean {
  const archivedOpen = useUIStore(state => state.archivedViewOpen)
  const graphOpen = useUIStore(state => state.activeGraphId !== null)
  const scheduleOpen = useUIStore(state => state.activeScheduleId !== null)
  return useIsHomeActive() && !archivedOpen && !graphOpen && !scheduleOpen
}

/**
 * Open Home: clear the project and worktree, close the pages that share
 * that state. Home is the state where no project and no worktree is
 * selected, so this keeps the view in step with the existing
 * `active_project_id` persistence, without a second source of truth.
 */
export function openHome(): void {
  useProjectsStore.getState().selectProject(null)
  useChatStore.getState().clearActiveWorktree()
  useUIStore.getState().setArchivedViewOpen(false)
  useUIStore.getState().setActiveScheduleId(null)
  useUIStore.getState().setActiveGraphId(null)
}
