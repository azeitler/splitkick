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
import { useUIStore } from '@/store/ui-store'
import { SidebarTabEmpty } from './SidebarTabEmpty'
import { useSidebarActiveSessionId } from './useSidebarActiveSessionId'

/**
 * The sidebar's To-Do tab (#125): every session marked as To-Do, across every
 * project, newest mark first.
 *
 * The mark lives on the session (`todo_at`), so the rows come straight from
 * the all-sessions cache the Home view and Starred already share. As in
 * Recent, a click keeps this tab open, so the list can be worked through.
 */
export function SidebarTodoSection() {
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

  const handleOpen = useCallback(
    (shortcut: SessionShortcut) => {
      // The hidden Projects tree follows, as from Recent.
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

  const renderAction = useCallback(
    (shortcut: SessionShortcut) => <TodoDoneButton shortcut={shortcut} />,
    []
  )

  if (shortcuts.length === 0) {
    return (
      <SidebarTabEmpty
        icon={<ListTodo />}
        title="Nothing to do"
        hint="Mark a session as To-Do to list it here."
        testId="sidebar-todo-empty"
      />
    )
  }

  return (
    <div data-testid="sidebar-todo-section">
      <SessionShortcutRows
        shortcuts={shortcuts}
        variant="sidebar"
        layout="stacked"
        sidebarRowClassName="py-1.5 pl-2 pr-1"
        sidebarNested={false}
        // Every row here is a To-Do; marking each would be noise.
        showTodoGlyph={false}
        activeSessionId={activeSessionId}
        renderAction={renderAction}
        onOpen={handleOpen}
      />
    </div>
  )
}
