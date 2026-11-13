import { useCallback, useMemo } from 'react'
import { Star } from 'lucide-react'
import { useCanvasStoreState } from '@/components/chat/hooks/useCanvasStoreState'
import { computeSessionCardData } from '@/components/chat/session-card-utils'
import {
  SessionShortcutRows,
  type SessionShortcut,
} from '@/components/chat/SessionShortcutRows'
import { resolveStarredSessions } from '@/components/home/home-utils'
import { useIsMobile } from '@/hooks/use-mobile'
import { moveStarredSession } from '@/components/chat/session-pin-actions'
import { navigateToSession } from '@/lib/navigate-to-session'
import { useAllSessions } from '@/services/chat'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import { SidebarTabEmpty } from './SidebarTabEmpty'
import { useSidebarActiveSessionId } from './useSidebarActiveSessionId'

/**
 * The sidebar's Starred tab: every starred session, in the user's order.
 *
 * A star is global, so the tab shows whatever project is selected. Rows
 * resolve against the all-sessions cache the Home view, the command palette
 * and the unread bell already share, so the tab adds no backend query. A click
 * switches to the Projects tab and reveals the session in the tree.
 */
export function SidebarStarredSection() {
  const stars = useProjectsStore(state => state.starredSessions)
  const isMobile = useIsMobile()
  // Only fetch once something is starred; the cache is usually warm anyway.
  const { data } = useAllSessions(stars.length > 0)
  const storeState = useCanvasStoreState()
  // The open session, highlighted here as well as in the tree (#92).
  const activeSessionId = useSidebarActiveSessionId()

  const shortcuts = useMemo((): SessionShortcut[] => {
    return resolveStarredSessions(stars, data?.entries ?? []).map(row => ({
      sessionId: row.session.id,
      projectId: row.projectId,
      worktreeId: row.worktreeId,
      worktreePath: row.worktreePath,
      session: row.session,
      card: computeSessionCardData(row.session, storeState),
      context: `${row.projectName} / ${row.worktreeName}`,
    }))
  }, [stars, data?.entries, storeState])

  const handleOpen = useCallback(
    (shortcut: SessionShortcut) => {
      // Show where the session lives: the tree expands to its row.
      navigateToSession(
        {
          projectId: shortcut.projectId,
          worktreeId: shortcut.worktreeId,
          sessionId: shortcut.sessionId,
        },
        { showProjectsTab: true }
      )
      if (isMobile) {
        useUIStore.getState().setLeftSidebarVisible(false)
      }
    },
    [isMobile]
  )

  const handleReorder = useCallback(
    (
      sessionId: string,
      targetSessionId: string,
      position: 'before' | 'after'
    ) => {
      void moveStarredSession(sessionId, targetSessionId, position)
    },
    []
  )

  if (shortcuts.length === 0) {
    return (
      <SidebarTabEmpty
        icon={<Star />}
        title="No starred sessions"
        hint="Star a session to keep it here."
        testId="sidebar-starred-empty"
      />
    )
  }

  return (
    <div data-testid="sidebar-starred-section">
      <SessionShortcutRows
        shortcuts={shortcuts}
        variant="sidebar"
        sidebarRowClassName="py-1.5 pl-2 pr-1"
        sidebarNested={false}
        // Every row here is a star; marking each would be noise.
        showStarGlyph={false}
        activeSessionId={activeSessionId}
        onOpen={handleOpen}
        onReorder={handleReorder}
      />
    </div>
  )
}
