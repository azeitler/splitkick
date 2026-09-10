import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'

/**
 * Whether the Home view is showing: no project and no worktree is selected.
 *
 * One definition for every surface that changes on Home — the sidebar Home
 * row, and the file browser, which has nothing to browse there.
 */
export function useIsHomeActive(): boolean {
  const noProject = useProjectsStore(state => state.selectedProjectId === null)
  const noWorktree = useChatStore(state => state.activeWorktreeId === null)
  return noProject && noWorktree
}

/** The same test outside React, for handlers that read the stores directly. */
export function isHomeActive(): boolean {
  return (
    useProjectsStore.getState().selectedProjectId === null &&
    useChatStore.getState().activeWorktreeId === null
  )
}
