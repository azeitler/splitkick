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
import { navigateToSession } from '@/lib/navigate-to-session'
import { useAllSessions } from '@/services/chat'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import { cn } from '@/lib/utils'
import {
  SIDEBAR_SECTION_HEADER_PADDING,
  SIDEBAR_WORKTREE_LIST,
  SIDEBAR_WORKTREE_ROW_PADDING,
} from './sidebar-row-styles'
import { SidebarStickySectionHeader } from './SidebarStickySectionHeader'

/**
 * Starred sessions near the top of the sidebar, pinned under the Home row.
 *
 * A star is global, so the section shows whatever project is selected. Rows
 * resolve against the all-sessions cache the Home view, the command palette
 * and the unread bell already share, so the section adds no backend query. It
 * renders nothing until at least one starred session resolves.
 */
export function SidebarStarredSection() {
  const stars = useProjectsStore(state => state.starredSessions)
  const collapsed = useProjectsStore(state => state.starredSectionCollapsed)
  const isMobile = useIsMobile()
  // Only fetch once something is starred; the cache is usually warm anyway.
  const { data } = useAllSessions(stars.length > 0)
  const storeState = useCanvasStoreState()

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

  const handleToggle = useCallback(() => {
    useProjectsStore.getState().toggleStarredSectionCollapsed()
  }, [])

  const handleOpen = useCallback(
    (shortcut: SessionShortcut) => {
      // The row already sits in the sidebar, so the tree stays put.
      navigateToSession(
        {
          projectId: shortcut.projectId,
          worktreeId: shortcut.worktreeId,
          sessionId: shortcut.sessionId,
        },
        { revealInSidebar: false }
      )
      if (isMobile) {
        useUIStore.getState().setLeftSidebarVisible(false)
      }
    },
    [isMobile]
  )

  if (shortcuts.length === 0) return null

  return (
    // `contents`: the header's containing block is the whole scroller, so it
    // stays stuck in slot 0 after you scroll past Starred.
    <div
      data-testid="sidebar-starred-section"
      data-sidebar-starred=""
      className="contents"
    >
      <SidebarStickySectionHeader
        top="0px"
        icon={<Star className="size-3.5 shrink-0" aria-hidden="true" />}
        label="Starred"
        count={shortcuts.length}
        expanded={!collapsed}
        onToggle={handleToggle}
        // Glyph and label on the Home row's columns.
        className={cn('gap-1', SIDEBAR_SECTION_HEADER_PADDING)}
        testId="sidebar-starred-toggle"
      />
      {!collapsed && (
        // The guide line runs under the header glyph and the rows sit one
        // step in (glyph at 32), as a project's workspace list does.
        <div className={cn(SIDEBAR_WORKTREE_LIST, 'py-0.5')}>
          <SessionShortcutRows
            shortcuts={shortcuts}
            variant="sidebar"
            sidebarRowClassName={cn('py-1', SIDEBAR_WORKTREE_ROW_PADDING)}
            // Every row here is a star; marking each would be noise.
            showStarGlyph={false}
            onOpen={handleOpen}
          />
        </div>
      )}
    </div>
  )
}
