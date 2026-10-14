import { useMemo, useState } from 'react'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { StatusIndicator } from '@/components/ui/status-indicator'
import { getLabelTextColor } from '@/lib/label-colors'
import { formatMessageTimestamp, formatRelativeTime } from '@/lib/relative-time'
import { cn } from '@/lib/utils'
import { usePreferences } from '@/services/preferences'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import type { Session } from '@/types/chat'
import { DraftGlyph } from './DraftGlyph'
import { LabelModal } from './LabelModal'
import { PinGlyph } from './PinGlyph'
import { StarGlyph } from './StarGlyph'
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
  /**
   * `inline` puts the context after the name on one line. `stacked` gives it
   * a second line, with the time ago beside the name, for lists that span
   * every project (Recent), where "project / workspace" is long.
   */
  layout?: 'inline' | 'stacked'
  /** The open session, highlighted like its row in the tree. */
  activeSessionId?: string | null
  onOpen: (shortcut: SessionShortcut) => void
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
  layout = 'inline',
  activeSessionId = null,
  onOpen,
}: SessionShortcutRowsProps) {
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

  return (
    <>
      {shortcuts.map(shortcut => {
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
              ? SIDEBAR_ROW_SELECTED
              : 'bg-primary/10 text-foreground'
            : isStacked
              ? 'text-foreground/90'
              : 'text-muted-foreground',
          isSidebar ? sidebarRowClassName : 'rounded px-2 py-1.5'
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
            {showStarGlyph && starredIds.has(shortcut.sessionId) && (
              <StarGlyph />
            )}
            {showPinGlyph &&
              pinnedKeys.has(`${shortcut.projectId}/${shortcut.sessionId}`) && (
                <PinGlyph />
              )}
          </>
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
              </>
            )}
          </>
        )

        return (
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
                  onClick={() => onOpen(shortcut)}
                  onContextMenuCapture={closeOpenSessionContextMenus}
                  title={`${session.name} — ${shortcut.context}`}
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
            />
          </ContextMenu>
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
