import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'

/**
 * Show a graph in the main area.
 *
 * Like Home and the Archived view, it is a state with no project and no
 * worktree selected, so it clears both first and closes the Archived view.
 * Selecting anything afterwards closes the graph again (see
 * `MainWindowContent`). With `nodeId`, the view opens that node's detail.
 */
export function openGraphView(graphId: string, nodeId?: string): void {
  useProjectsStore.getState().selectProject(null)
  useChatStore.getState().clearActiveWorktree()
  const ui = useUIStore.getState()
  ui.setArchivedViewOpen(false)
  ui.setActiveGraphId(graphId)
  ui.setGraphFocusNodeId(nodeId ?? null)
}
