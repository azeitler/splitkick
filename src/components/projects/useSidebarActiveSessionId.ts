import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'

/**
 * The open session, as the project tree marks it: the active session of the
 * selected workspace. Rows outside the tree (Recent, Starred, Pinned) use it
 * to highlight the same session.
 *
 * The selector returns the id itself, not a getter, so a section re-renders
 * only when the open session changes.
 */
export function useSidebarActiveSessionId(): string | null {
  const selectedWorktreeId = useProjectsStore(state => state.selectedWorktreeId)
  return useChatStore(state =>
    selectedWorktreeId
      ? (state.activeSessionIds[selectedWorktreeId] ?? null)
      : null
  )
}
