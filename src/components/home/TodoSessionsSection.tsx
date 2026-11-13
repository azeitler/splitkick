import { memo, useCallback, useMemo, useState } from 'react'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { StatusIndicator } from '@/components/ui/status-indicator'
import { navigateToSession } from '@/lib/navigate-to-session'
import { useAllSessions } from '@/services/chat'
import { usePreferences } from '@/services/preferences'
import { useChatStore } from '@/store/chat-store'
import { useCanvasStoreState } from '@/components/chat/hooks/useCanvasStoreState'
import { useSessionRemoval } from '@/components/chat/hooks/useSessionArchive'
import { useSessionRename } from '@/components/chat/hooks/useSessionRename'
import { LabelModal } from '@/components/chat/LabelModal'
import {
  SessionContextMenuItems,
  closeOpenSessionContextMenus,
} from '@/components/chat/SessionContextMenuItems'
import {
  computeSessionCardData,
  statusConfig,
} from '@/components/chat/session-card-utils'
import { TodoDoneButton, todoMarkedText } from '@/components/chat/TodoRowParts'
import { HomeSection } from './HomeSection'
import { resolveTodoSessions, type TodoSessionEntry } from './home-utils'

type SessionRename = ReturnType<typeof useSessionRename>

/**
 * The To-Do list on the Home view (#125): every session marked as To-Do,
 * across every project, newest mark first. The check beside a row clears the
 * mark. Hidden while nothing is marked. A right-click opens the same session
 * menu as in the sidebar.
 */
export const TodoSessionsSection = memo(function TodoSessionsSection() {
  const { data } = useAllSessions()
  const storeState = useCanvasStoreState()
  const { data: preferences } = usePreferences()
  const { archive, remove } = useSessionRemoval(preferences?.removal_behavior)
  const rename = useSessionRename()
  const [labelSessionId, setLabelSessionId] = useState<string | null>(null)
  const labelSessionLabel = useChatStore(state =>
    labelSessionId ? (state.sessionLabels[labelSessionId] ?? null) : null
  )

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
            rename={rename}
            onManageLabels={setLabelSessionId}
            onArchive={sessionId =>
              archive({
                sessionId,
                worktreeId: row.worktreeId,
                worktreePath: row.worktreePath,
              })
            }
            onDelete={sessionId =>
              remove({
                sessionId,
                worktreeId: row.worktreeId,
                worktreePath: row.worktreePath,
              })
            }
          />
        ))}
      </ul>
      <LabelModal
        isOpen={labelSessionId !== null}
        onClose={() => setLabelSessionId(null)}
        sessionId={labelSessionId}
        currentLabel={labelSessionLabel}
      />
    </HomeSection>
  )
})

function TodoSessionRow({
  row,
  storeState,
  rename,
  onManageLabels,
  onArchive,
  onDelete,
}: {
  row: TodoSessionEntry
  storeState: ReturnType<typeof useCanvasStoreState>
  rename: SessionRename
  onManageLabels: (sessionId: string) => void
  onArchive: (sessionId: string) => void
  onDelete: (sessionId: string) => void
}) {
  const card = useMemo(
    () => computeSessionCardData(row.session, storeState),
    [row.session, storeState]
  )
  const status = statusConfig[card.status]
  const {
    renamingSessionId,
    renameValue,
    setRenameValue,
    renameInputRef,
    startRename,
    handleRenameBlur,
    handleRenameKeyDown,
  } = rename
  const isRenaming = renamingSessionId === row.session.id

  const handleOpen = useCallback(() => {
    navigateToSession({
      projectId: row.projectId,
      worktreeId: row.worktreeId,
      sessionId: row.session.id,
    })
  }, [row])

  const rowClassName =
    'grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2.5 gap-y-0.5 py-2 pl-3 pr-12 text-left transition-colors hover:bg-accent/50'
  const rowContent = (
    <>
      <StatusIndicator
        status={status.indicatorStatus}
        variant={status.indicatorVariant}
        shape={status.indicatorShape}
        label={status.label}
        className="h-2 w-2 shrink-0"
      />
      {isRenaming ? (
        <input
          ref={renameInputRef}
          type="text"
          aria-label="Session name"
          value={renameValue}
          onChange={e => setRenameValue(e.target.value)}
          onBlur={e => handleRenameBlur(e, row.session.name)}
          onKeyDown={e => handleRenameKeyDown(e, row.session.name)}
          className="w-full min-w-0 bg-transparent text-sm outline-none"
        />
      ) : (
        <span className="truncate text-sm">
          {row.session.name || 'Untitled'}
        </span>
      )}
      <span className="col-start-2 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">
          {`${row.projectName} / ${row.worktreeName}`}
        </span>
        <span className="shrink-0 tabular-nums">
          {todoMarkedText(row.todoAt)}
        </span>
      </span>
    </>
  )

  // Same two lines as a Recent row. The check sits beside the row button,
  // not in it, because a button cannot hold another one.
  return (
    <li className="relative" data-testid="home-todo-row">
      <ContextMenu>
        {/* Disabled while renaming: a right-click in the input gets the
            text menu, not the session menu. */}
        <ContextMenuTrigger asChild disabled={isRenaming}>
          {isRenaming ? (
            // An <input> cannot live inside a <button>.
            <div className={rowClassName}>{rowContent}</div>
          ) : (
            <button
              type="button"
              onClick={handleOpen}
              onContextMenuCapture={closeOpenSessionContextMenus}
              className={rowClassName}
            >
              {rowContent}
            </button>
          )}
        </ContextMenuTrigger>
        <SessionContextMenuItems
          card={card}
          worktreeId={row.worktreeId}
          projectId={row.projectId}
          contentClassName="w-56"
          onRename={(sessionId, currentName) =>
            startRename({
              sessionId,
              currentName,
              worktreeId: row.worktreeId,
              worktreePath: row.worktreePath,
            })
          }
          onManageLabels={onManageLabels}
          onArchive={onArchive}
          onDelete={onDelete}
        />
      </ContextMenu>
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
