import { SidebarSectionRow } from '@/components/chat/SidebarSectionRow'
import { useCallback, useMemo } from 'react'
import { ListTodo } from 'lucide-react'
import { useCanvasStoreState } from '@/components/chat/hooks/useCanvasStoreState'
import { computeSessionCardData } from '@/components/chat/session-card-utils'
import {
  SessionShortcutRows,
  type SessionShortcut,
} from '@/components/chat/SessionShortcutRows'
import { TodoDoneButton, todoMarkedText } from '@/components/chat/TodoRowParts'
import { resolveTodoSessions } from '@/components/home/home-utils'
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
import { useSidebarActiveSessionId } from './useSidebarActiveSessionId'

/**
 * The To-Do list in the sidebar (#125), under Starred: every session marked
 * as To-Do, across every project, newest mark first.
 *
 * The mark lives on the session (`todo_at`), so the rows come straight from
 * the all-sessions cache the Home view and Starred already share. Renders
 * nothing while nothing is marked.
 */
export function SidebarTodoSection() {
  const collapsed = useProjectsStore(state => state.todoSectionCollapsed)
  const isMobile = useIsMobile()
  const { data } = useAllSessions()
  const storeState = useCanvasStoreState()
  const activeSessionId = useSidebarActiveSessionId()

  const shortcuts = useMemo((): SessionShortcut[] => {
    return resolveTodoSessions(data?.entries ?? []).map(row => ({
      sessionId: row.session.id,
      projectId: row.projectId,
      worktreeId: row.worktreeId,
      worktreePath: row.worktreePath,
      session: row.session,
      card: computeSessionCardData(row.session, storeState),
      context: `${row.projectName} / ${row.worktreeName}`,
      detail: todoMarkedText(row.todoAt, { short: true }),
    }))
  }, [data?.entries, storeState])

  const handleToggle = useCallback(() => {
    useProjectsStore.getState().toggleTodoSectionCollapsed()
  }, [])

  const handleOpen = useCallback(
    (shortcut: SessionShortcut) => {
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

  const renderAction = useCallback(
    (shortcut: SessionShortcut) => <TodoDoneButton shortcut={shortcut} />,
    []
  )

  if (shortcuts.length === 0) return null

  return (
    <div data-testid="sidebar-todo-section">
      <SidebarSectionRow
        icon={<ListTodo className="size-3.5 shrink-0" aria-hidden="true" />}
        label="To-Do"
        count={shortcuts.length}
        expanded={!collapsed}
        onToggle={handleToggle}
        className={cn('gap-1', SIDEBAR_SECTION_HEADER_PADDING)}
        testId="sidebar-todo-toggle"
      />
      {!collapsed && (
        <div className={cn(SIDEBAR_WORKTREE_LIST, 'py-0.5')}>
          <SessionShortcutRows
            shortcuts={shortcuts}
            variant="sidebar"
            layout="stacked"
            sidebarRowClassName={cn('py-1', SIDEBAR_WORKTREE_ROW_PADDING)}
            // Every row here is a To-Do; marking each would be noise.
            showTodoGlyph={false}
            activeSessionId={activeSessionId}
            renderAction={renderAction}
            onOpen={handleOpen}
          />
        </div>
      )}
    </div>
  )
}
