import { useCallback, useMemo } from 'react'
import { useCanvasStoreState } from '@/components/chat/hooks/useCanvasStoreState'
import { computeSessionCardData } from '@/components/chat/session-card-utils'
import {
  SessionShortcutRows,
  type SessionShortcut,
} from '@/components/chat/SessionShortcutRows'
import {
  flattenAllSessions,
  groupSessionsByDay,
} from '@/components/home/home-utils'
import { useIsMobile } from '@/hooks/use-mobile'
import { navigateToSession } from '@/lib/navigate-to-session'
import { useAllSessions } from '@/services/chat'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'

/** The list is a jump list, not an archive; older sessions live in the tree. */
export const SIDEBAR_RECENT_LIMIT = 30

/**
 * The sidebar's Recent tab: the latest sessions of every project, newest
 * first, under Today / Yesterday / Earlier headings.
 *
 * Rows resolve against the all-sessions cache the Home view, the Starred
 * section and the command palette already share, so the tab adds no backend
 * query. Each row names its project and workspace on a second line, because
 * the list spans every project.
 */
export function SidebarRecentSessions() {
  const isMobile = useIsMobile()
  const { data, isLoading } = useAllSessions()
  const storeState = useCanvasStoreState()
  // The open session: the active one of the selected workspace, as in the tree.
  const selectedWorktreeId = useProjectsStore(state => state.selectedWorktreeId)
  const activeSessionId = useChatStore(state =>
    selectedWorktreeId
      ? (state.activeSessionIds[selectedWorktreeId] ?? null)
      : null
  )

  const groups = useMemo(() => {
    const rows = flattenAllSessions(data?.entries ?? []).slice(
      0,
      SIDEBAR_RECENT_LIMIT
    )
    return groupSessionsByDay(rows).map(group => ({
      label: group.label,
      shortcuts: group.rows.map(
        (row): SessionShortcut => ({
          sessionId: row.session.id,
          projectId: row.projectId,
          worktreeId: row.worktreeId,
          worktreePath: row.worktreePath,
          session: row.session,
          card: computeSessionCardData(row.session, storeState),
          context: `${row.projectName} / ${row.worktreeName}`,
          activityAt: row.activityAt,
        })
      ),
    }))
  }, [data?.entries, storeState])

  const handleOpen = useCallback(
    (shortcut: SessionShortcut) => {
      // Revealing the row in the hidden tree would expand it for nothing.
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-4">
        <span className="text-sm text-muted-foreground">Loading...</span>
      </div>
    )
  }

  if (groups.length === 0) {
    return (
      <div className="flex items-center justify-center px-2 py-4">
        <span className="truncate text-sm text-muted-foreground/50">
          No sessions yet
        </span>
      </div>
    )
  }

  return (
    <div data-testid="sidebar-recent-sessions">
      {groups.map(group => (
        <section key={group.label} aria-label={group.label}>
          <h3 className="px-3 pb-0.5 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
            {group.label}
          </h3>
          <SessionShortcutRows
            shortcuts={group.shortcuts}
            variant="sidebar"
            layout="stacked"
            sidebarRowClassName="py-1.5 pl-3 pr-2"
            activeSessionId={activeSessionId}
            onOpen={handleOpen}
          />
        </section>
      ))}
    </div>
  )
}
