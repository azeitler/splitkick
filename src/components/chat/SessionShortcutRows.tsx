import { useMemo, useState, type DragEvent, type ReactNode } from 'react'
import { DropIndicator } from '@/components/drag-and-drop/DropIndicator'
import { AgentBadge } from '@/components/graphs/AgentBadge'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { StatusIndicator } from '@/components/ui/status-indicator'
import { getLabelTextColor } from '@/lib/label-colors'
import { formatMessageTimestamp, formatRelativeTime } from '@/lib/relative-time'
import { cn } from '@/lib/utils'
import { usePreferences } from '@/services/preferences'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useIsMobile } from '@/hooks/use-mobile'
import { isNativeApp } from '@/lib/environment'
import type { Session } from '@/types/chat'
import { DraftGlyph } from './DraftGlyph'
import { LimitGlyph } from './limit-hit'
import { RunErrorGlyph } from './run-error'
import { LabelModal } from './LabelModal'
import { PinGlyph } from './PinGlyph'
import { StarGlyph } from './StarGlyph'
import { TodoGlyph } from './TodoGlyph'
import { SessionNetworkGlyph } from './SessionNetworkIndicator'
import { useDraftSessionIds } from './hooks/useDraftSessionIds'
import { useSessionRemoval } from './hooks/useSessionArchive'
import { useSessionRename } from './hooks/useSessionRename'
import {
  SessionContextMenuItems,
  closeOpenSessionContextMenus,
} from './SessionContextMenuItems'
import { statusConfig, type SessionCardData } from './session-card-utils'
import {
  SIDEBAR_SESSION_ROW_PADDING,
  SIDEBAR_NESTED_ROW_SHAPE,
  SIDEBAR_ROW_SELECTED,
  SIDEBAR_ROW_SHAPE,
} from '@/components/projects/sidebar-row-styles'

/** A session shown outside its workspace: a pin, or a star. */
export interface SessionShortcut {
  sessionId: string
  projectId: string
  worktreeId: string
  worktreePath: string
  session: Session
  card: SessionCardData
  /** Secondary text after the name: the workspace, or "project / workspace". */
  context: string
  /** Last activity; the `stacked` layout shows it as time ago. */
  activityAt?: number
  /** Extra text: its own line in `stacked`, after the context in `inline`. */
  detail?: ReactNode
}

interface SessionShortcutRowsProps {
  shortcuts: SessionShortcut[]
  /** `canvas` rows are rounded cards; `sidebar` rows are flat tree rows. */
  variant: 'canvas' | 'sidebar'
  /** Sidebar indent, so the rows line up under their parent row. */
  sidebarRowClassName?: string
  /** The rows sit under a tree guide line (Pinned, Starred), so their
   * selection pill keeps a smaller inset than a top-level row (Recent). */
  sidebarNested?: boolean
  /** Mark starred sessions with a star. Off where every row is a star anyway. */
  showStarGlyph?: boolean
  /** Mark pinned sessions with a pin. Off where every row is a pin anyway. */
  showPinGlyph?: boolean
  /** Mark To-Do sessions. Off where every row is a To-Do anyway. */
  showTodoGlyph?: boolean
  /**
   * A button beside each row (e.g. the To-Do check). It sits outside the row
   * button, because a button cannot hold another one.
   */
  renderAction?: (shortcut: SessionShortcut) => ReactNode
  /**
   * `inline` puts the context after the name on one line. `stacked` gives it
   * a second line, with the time ago beside the name, for lists that span
   * every project (Recent), where "project / workspace" is long.
   */
  layout?: 'inline' | 'stacked'
  /** The open session, highlighted like its row in the tree. */
  activeSessionId?: string | null
  onOpen: (shortcut: SessionShortcut) => void
  /**
   * Makes the rows reorderable (Starred): drag and drop, Move Up / Move Down
   * in the context menu, and Alt+Arrow on a focused row (native desktop).
   */
  onReorder?: (
    sessionId: string,
    targetSessionId: string,
    position: 'before' | 'after'
  ) => void
}

/** Drag payload type, so a drop from anywhere else is ignored. */
const SHORTCUT_DRAG_TYPE = 'application/x-splitkick-session-shortcut'

interface ShortcutDragState {
  draggingId: string | null
  targetId: string | null
  edge: 'top' | 'bottom' | null
}

const noDrag: ShortcutDragState = {
  draggingId: null,
  targetId: null,
  edge: null,
}

/** Focus a row again after a keyboard move; React may re-insert its node. */
function focusShortcutRow(sessionId: string): void {
  requestAnimationFrame(() => {
    document
      .querySelector<HTMLElement>(
        `[data-shortcut-row-id="${CSS.escape(sessionId)}"]`
      )
      ?.focus()
  })
}

/**
 * Session rows shown outside their workspace, used by the Pinned and Starred
 * sections.
 *
 * Every row carries the same context menu as the session's row under its
 * workspace (`SessionContextMenuItems`). The rows come from several worktrees,
 * and for stars from several projects, so rename and removal take their target
 * per call — see `useSessionRename` and `useSessionRemoval`.
 */
export function SessionShortcutRows({
  shortcuts,
  variant,
  sidebarRowClassName = cn('py-1', SIDEBAR_SESSION_ROW_PADDING),
  sidebarNested = true,
  showStarGlyph = true,
  showPinGlyph = true,
  showTodoGlyph = true,
  renderAction,
  layout = 'inline',
  activeSessionId = null,
  onOpen,
  onReorder,
}: SessionShortcutRowsProps) {
  const isMobile = useIsMobile()
  // Keyboard moves and their hint are native desktop only.
  const desktopKeys = !isMobile && isNativeApp()
  const [drag, setDrag] = useState<ShortcutDragState>(noDrag)
  const { data: preferences } = usePreferences()
  const { archive, remove } = useSessionRemoval(preferences?.removal_behavior)
  const {
    renamingSessionId,
    renameValue,
    setRenameValue,
    renameInputRef,
    startRename,
    handleRenameBlur,
    handleRenameKeyDown,
  } = useSessionRename()
  const [labelModalOpen, setLabelModalOpen] = useState(false)
  const [labelTargetSessionId, setLabelTargetSessionId] = useState<
    string | null
  >(null)
  const labelTargetLabel = useChatStore(state =>
    labelTargetSessionId
      ? (state.sessionLabels[labelTargetSessionId] ?? null)
      : null
  )
  // Sessions holding an unsent message, so a row can show the draft pencil.
  const draftSessionIds = useDraftSessionIds()
  const starredSessions = useProjectsStore(state => state.starredSessions)
  const starredIds = useMemo(
    () => new Set(starredSessions.map(star => star.sessionId)),
    [starredSessions]
  )
  // Rows can come from several projects (Starred), and a pin belongs to one
  // project, so the key carries both ids.
  const projectCanvasSettings = useProjectsStore(
    state => state.projectCanvasSettings
  )
  const pinnedKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const [projectId, settings] of Object.entries(projectCanvasSettings)) {
      for (const pin of settings.pinnedSessions ?? []) {
        keys.add(`${projectId}/${pin.sessionId}`)
      }
    }
    return keys
  }, [projectCanvasSettings])

  const isSidebar = variant === 'sidebar'
  const sidebarShape = sidebarNested
    ? SIDEBAR_NESTED_ROW_SHAPE
    : SIDEBAR_ROW_SHAPE
  const isStacked = layout === 'stacked'

  const moveBy = (index: number, step: -1 | 1) => {
    const neighbour = shortcuts[index + step]
    const shortcut = shortcuts[index]
    if (!onReorder || !neighbour || !shortcut) return
    onReorder(
      shortcut.sessionId,
      neighbour.sessionId,
      step === -1 ? 'before' : 'after'
    )
    focusShortcutRow(shortcut.sessionId)
  }

  const handleDragOver = (event: DragEvent<HTMLDivElement>, id: string) => {
    if (!drag.draggingId) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (drag.draggingId === id) {
      if (drag.targetId) setDrag({ ...drag, targetId: null, edge: null })
      return
    }
    // Only this list's own rows; files or other drags pass through.
    if (!event.dataTransfer.types.includes(SHORTCUT_DRAG_TYPE)) return
    const rect = event.currentTarget.getBoundingClientRect()
    const edge = event.clientY < rect.top + rect.height / 2 ? 'top' : 'bottom'
    // The gap right above or below the dragged row would not move it, so
    // it gets no indicator.
    const from = shortcuts.findIndex(s => s.sessionId === drag.draggingId)
    const to = shortcuts.findIndex(s => s.sessionId === id)
    const noMove = to + (edge === 'top' ? -1 : 1) === from
    const next = noMove
      ? { targetId: null, edge: null }
      : { targetId: id, edge: edge as 'top' | 'bottom' }
    if (drag.targetId === next.targetId && drag.edge === next.edge) return
    setDrag({ ...drag, ...next })
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!drag.draggingId) return
    event.preventDefault()
    const { draggingId, targetId, edge } = drag
    setDrag(noDrag)
    if (onReorder && targetId && edge) {
      onReorder(draggingId, targetId, edge === 'top' ? 'before' : 'after')
    }
  }

  return (
    <>
      {shortcuts.map((shortcut, index) => {
        const { session, card } = shortcut
        const config = statusConfig[card.status]
        const isRenaming = renamingSessionId === shortcut.sessionId
        const target = {
          worktreeId: shortcut.worktreeId,
          worktreePath: shortcut.worktreePath,
        }
        const isActive = activeSessionId === shortcut.sessionId
        const rowClassName = cn(
          'text-left text-sm hover:bg-accent/50 hover:text-foreground',
          isSidebar ? sidebarShape : 'w-full',
          isStacked
            ? 'grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-1.5 gap-y-0.5'
            : 'flex items-center gap-1.5 truncate',
          isActive
            ? isSidebar
              ? cn(SIDEBAR_ROW_SELECTED, 'font-medium')
              : 'bg-primary/10 text-foreground'
            : isStacked
              ? 'text-foreground/90'
              : 'text-muted-foreground',
          isSidebar ? sidebarRowClassName : 'rounded px-2 py-1.5',
          // Room for the action, which overlays the row's right edge.
          renderAction && 'pr-8'
        )
        const statusDot = (
          <StatusIndicator
            status={config.indicatorStatus}
            variant={config.indicatorVariant}
            shape={config.indicatorShape}
            label={config.label}
            className="h-1.5 w-1.5 shrink-0"
          />
        )
        const draftGlyph = draftSessionIds.has(shortcut.sessionId) && (
          <DraftGlyph />
        )
        const renameInput = (
          <input
            ref={renameInputRef}
            type="text"
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onBlur={e => handleRenameBlur(e, session.name)}
            onKeyDown={e => handleRenameKeyDown(e, session.name)}
            onClick={e => e.stopPropagation()}
            className="w-full min-w-0 bg-transparent text-xs outline-none"
          />
        )
        const markGlyphs = (
          <>
            <AgentBadge agentId={session.agent_id} sessionName={session.name} />
            <SessionNetworkGlyph
              sessionId={session.id}
              startedBySessionId={session.started_by_session_id}
            />
            {card.limitHit && <LimitGlyph limit={card.limitHit} />}
            {card.runError && <RunErrorGlyph error={card.runError} />}
            {showStarGlyph && starredIds.has(shortcut.sessionId) && (
              <StarGlyph />
            )}
            {showPinGlyph &&
              pinnedKeys.has(`${shortcut.projectId}/${shortcut.sessionId}`) && (
                <PinGlyph />
              )}
            {showTodoGlyph && session.todo_at && <TodoGlyph />}
          </>
        )
        const detailText = shortcut.detail && (
          <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
            {shortcut.detail}
          </span>
        )
        const contextText = (
          <span
            className={cn(
              'truncate text-[10px] text-muted-foreground/70',
              isStacked ? 'min-w-0 flex-1' : 'shrink-0'
            )}
          >
            {shortcut.context}
          </span>
        )
        const labelBadge = card.label && (
          <span
            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
            style={{
              backgroundColor: card.label.color,
              color: getLabelTextColor(card.label.color),
            }}
          >
            {card.label.name}
          </span>
        )
        // Stacked: a three-column grid. The glyphs stay inside the name cell,
        // so an optional one never shifts the time or line 2 out of place.
        const rowContent = isStacked ? (
          <>
            {statusDot}
            <span className="flex min-w-0 items-center gap-1 text-xs">
              {draftGlyph}
              {isRenaming ? (
                renameInput
              ) : (
                <>
                  <span className="truncate">{session.name || 'Untitled'}</span>
                  {markGlyphs}
                </>
              )}
            </span>
            {shortcut.activityAt === undefined ? (
              <span />
            ) : (
              <span
                className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70"
                title={`Last active: ${formatMessageTimestamp(shortcut.activityAt)}`}
              >
                {formatRelativeTime(shortcut.activityAt)}
              </span>
            )}
            {/* Line 2, under the name: where the session lives. */}
            <span className="col-start-2 col-end-4 flex min-w-0 items-center gap-1.5">
              {contextText}
              {labelBadge}
            </span>
            {/* Line 3, so a long detail never squeezes out the context. */}
            {shortcut.detail && (
              <span className="col-start-2 col-end-4 truncate text-[10px] tabular-nums text-muted-foreground/70">
                {shortcut.detail}
              </span>
            )}
          </>
        ) : (
          <>
            {statusDot}
            {draftGlyph}
            {isRenaming ? (
              renameInput
            ) : (
              <>
                <span
                  className={cn(
                    'truncate',
                    isSidebar && 'min-w-0 flex-1 text-xs'
                  )}
                >
                  {session.name}
                </span>
                {markGlyphs}
                {contextText}
                {labelBadge}
                {detailText}
              </>
            )}
          </>
        )

        const row = (
          <ContextMenu key={shortcut.sessionId}>
            {/* Disabled while renaming: a right-click in the input gets the
                text menu, not the session menu. */}
            <ContextMenuTrigger asChild disabled={isRenaming}>
              {isRenaming ? (
                // An <input> cannot live inside a <button>, so the row
                // degrades to a plain container while renaming.
                <div className={rowClassName}>{rowContent}</div>
              ) : (
                <button
                  type="button"
                  data-shortcut-row-id={shortcut.sessionId}
                  onClick={() => onOpen(shortcut)}
                  onKeyDown={
                    onReorder && desktopKeys
                      ? e => {
                          if (!e.altKey || e.metaKey || e.ctrlKey) return
                          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') {
                            return
                          }
                          e.preventDefault()
                          moveBy(index, e.key === 'ArrowUp' ? -1 : 1)
                        }
                      : undefined
                  }
                  onContextMenuCapture={closeOpenSessionContextMenus}
                  title={`${session.name} — ${shortcut.context}`}
                  aria-current={isActive ? 'page' : undefined}
                  className={rowClassName}
                >
                  {rowContent}
                </button>
              )}
            </ContextMenuTrigger>
            <SessionContextMenuItems
              card={card}
              worktreeId={shortcut.worktreeId}
              projectId={shortcut.projectId}
              contentClassName="w-56"
              onRename={(sessionId, currentName) =>
                startRename({ sessionId, currentName, ...target })
              }
              onManageLabels={sessionId => {
                setLabelTargetSessionId(sessionId)
                setLabelModalOpen(true)
              }}
              onArchive={sessionId => archive({ sessionId, ...target })}
              onDelete={sessionId => remove({ sessionId, ...target })}
              reorder={
                onReorder
                  ? {
                      onMoveUp: index > 0 ? () => moveBy(index, -1) : undefined,
                      onMoveDown:
                        index < shortcuts.length - 1
                          ? () => moveBy(index, 1)
                          : undefined,
                      showShortcutHint: desktopKeys,
                    }
                  : undefined
              }
            />
          </ContextMenu>
        )
        if (onReorder) {
          const isDragging = drag.draggingId === shortcut.sessionId
          return (
            <div
              key={shortcut.sessionId}
              data-testid="session-shortcut-draggable"
              // Not while renaming: a drag would start from the input.
              draggable={!isRenaming}
              onDragStart={event => {
                event.dataTransfer.effectAllowed = 'move'
                // WebKit starts a drag only when it carries data.
                event.dataTransfer.setData(
                  SHORTCUT_DRAG_TYPE,
                  shortcut.sessionId
                )
                setDrag({ ...noDrag, draggingId: shortcut.sessionId })
              }}
              onDragOver={event => handleDragOver(event, shortcut.sessionId)}
              onDrop={handleDrop}
              onDragEnd={() => setDrag(noDrag)}
              className={cn('relative', isDragging && 'opacity-40')}
            >
              <DropIndicator
                edge={drag.targetId === shortcut.sessionId ? drag.edge : null}
                insetClassName="left-1 right-2"
              />
              {row}
              {renderAction && (
                <div className="absolute inset-y-0 right-3 flex items-center">
                  {renderAction(shortcut)}
                </div>
              )}
            </div>
          )
        }
        if (!renderAction) return row
        return (
          <div key={shortcut.sessionId} className="relative">
            {row}
            <div className="absolute inset-y-0 right-3 flex items-center">
              {renderAction(shortcut)}
            </div>
          </div>
        )
      })}

      <LabelModal
        isOpen={labelModalOpen}
        onClose={() => {
          setLabelModalOpen(false)
          setLabelTargetSessionId(null)
        }}
        sessionId={labelTargetSessionId}
        currentLabel={labelTargetLabel}
      />
    </>
  )
}
