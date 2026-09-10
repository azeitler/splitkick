import { useCallback, useMemo } from 'react'
import { Star } from 'lucide-react'
import { useCanvasStoreState } from '@/components/chat/hooks/useCanvasStoreState'
import { computeSessionCardData } from '@/components/chat/session-card-utils'
import {
  SessionShortcutRows,
  type SessionShortcut,
} from '@/components/chat/SessionShortcutRows'
import { SidebarSectionRow } from '@/components/chat/SidebarSectionRow'
import { resolveStarredSessions } from '@/components/home/home-utils'
import { useIsMobile } from '@/hooks/use-mobile'
import { navigateToSession } from '@/lib/navigate-to-session'
import { useAllSessions } from '@/services/chat'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'

/**
 * Starred sessions at the top of the sidebar, under the Home row.
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
      navigateToSession({
        projectId: shortcut.projectId,
        worktreeId: shortcut.worktreeId,
        sessionId: shortcut.sessionId,
      })
      if (isMobile) {
        useUIStore.getState().setLeftSidebarVisible(false)
      }
    },
    [isMobile]
  )

  if (shortcuts.length === 0) return null

  return (
    <div data-testid="sidebar-starred-section">
      <SidebarSectionRow
        icon={<Star className="size-3.5 shrink-0" aria-hidden="true" />}
        label="Starred"
        count={shortcuts.length}
        expanded={!collapsed}
        onToggle={handleToggle}
        // Same inset and gap as the Home row above it: glyph on the section
        // header column, label on the project-name column.
        className="gap-1 pl-3"
        testId="sidebar-starred-toggle"
      />
      {!collapsed && (
        <div className="ml-4 border-l border-border/40 py-0.5">
          <SessionShortcutRows
            shortcuts={shortcuts}
            variant="sidebar"
            sidebarRowClassName="py-1 pl-3 pr-2"
            // Every row here is a star; marking each would be noise.
            showStarGlyph={false}
            onOpen={handleOpen}
          />
        </div>
      )}
    </div>
  )
}
