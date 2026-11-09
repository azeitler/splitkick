import { memo, useCallback, useMemo } from 'react'
import { StatusIndicator } from '@/components/ui/status-indicator'
import { navigateToSession } from '@/lib/navigate-to-session'
import { useAllSessions } from '@/services/chat'
import { useCanvasStoreState } from '@/components/chat/hooks/useCanvasStoreState'
import {
  computeSessionCardData,
  statusConfig,
} from '@/components/chat/session-card-utils'
import { TodoDoneButton, todoMarkedText } from '@/components/chat/TodoRowParts'
import { HomeSection } from './HomeSection'
import { resolveTodoSessions, type TodoSessionEntry } from './home-utils'

/**
 * The To-Do list on the Home view (#125): every session marked as To-Do,
 * across every project, newest mark first. The check beside a row clears the
 * mark. Hidden while nothing is marked.
 */
export const TodoSessionsSection = memo(function TodoSessionsSection() {
  const { data } = useAllSessions()
  const storeState = useCanvasStoreState()

  const rows = useMemo(
    () => resolveTodoSessions(data?.entries ?? []),
    [data?.entries]
  )

  if (rows.length === 0) return null

  return (
    <HomeSection title={`To-Do (${rows.length})`}>
      <ul
        className="flex flex-col divide-y divide-border/60 rounded-md border bg-muted/20"
        data-testid="home-todo-sessions"
      >
        {rows.map(row => (
          <TodoSessionRow
            key={row.session.id}
            row={row}
            storeState={storeState}
          />
        ))}
      </ul>
    </HomeSection>
  )
})

function TodoSessionRow({
  row,
  storeState,
}: {
  row: TodoSessionEntry
  storeState: ReturnType<typeof useCanvasStoreState>
}) {
  const card = useMemo(
    () => computeSessionCardData(row.session, storeState),
    [row.session, storeState]
  )
  const status = statusConfig[card.status]

  const handleOpen = useCallback(() => {
    navigateToSession({
      projectId: row.projectId,
      worktreeId: row.worktreeId,
      sessionId: row.session.id,
    })
  }, [row])

  // Same two lines as a Recent row. The check sits beside the row button,
  // not in it, because a button cannot hold another one.
  return (
    <li className="relative" data-testid="home-todo-row">
      <button
        type="button"
        onClick={handleOpen}
        className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 gap-y-0.5 py-2 pl-3 pr-12 text-left transition-colors hover:bg-accent/50"
      >
        <StatusIndicator
          status={status.indicatorStatus}
          variant={status.indicatorVariant}
          shape={status.indicatorShape}
          label={status.label}
          className="h-2 w-2 shrink-0"
        />
        <span className="truncate text-sm">
          {row.session.name || 'Untitled'}
        </span>
        <span className="col-start-2 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">
            {`${row.projectName} / ${row.worktreeName}`}
          </span>
          <span className="shrink-0 tabular-nums">
            {todoMarkedText(row.todoAt)}
          </span>
        </span>
      </button>
      <div className="absolute inset-y-0 right-3 flex items-center">
        <TodoDoneButton
          shortcut={{
            sessionId: row.session.id,
            worktreeId: row.worktreeId,
            session: row.session,
          }}
        />
      </div>
    </li>
  )
}
