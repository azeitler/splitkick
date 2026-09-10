import { useMemo, useState } from 'react'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { StatusIndicator } from '@/components/ui/status-indicator'
import { getLabelTextColor } from '@/lib/label-colors'
import { cn } from '@/lib/utils'
import { usePreferences } from '@/services/preferences'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import type { Session } from '@/types/chat'
import { LabelModal } from './LabelModal'
import { PinGlyph } from './PinGlyph'
import { StarGlyph } from './StarGlyph'
import { useSessionRemoval } from './hooks/useSessionArchive'
import { useSessionRename } from './hooks/useSessionRename'
import {
  SessionContextMenuItems,
  closeOpenSessionContextMenus,
} from './SessionContextMenuItems'
import { statusConfig, type SessionCardData } from './session-card-utils'

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
}

interface SessionShortcutRowsProps {
  shortcuts: SessionShortcut[]
  /** `canvas` rows are rounded cards; `sidebar` rows are flat tree rows. */
  variant: 'canvas' | 'sidebar'
  /** Sidebar indent, so the rows line up under their parent row. */
  sidebarRowClassName?: string
  /** Mark starred sessions with a star. Off where every row is a star anyway. */
  showStarGlyph?: boolean
  /** Mark pinned sessions with a pin. Off where every row is a pin anyway. */
  showPinGlyph?: boolean
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
  sidebarRowClassName = 'py-1 pl-5 pr-2',
  showStarGlyph = true,
  showPinGlyph = true,
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
    submitRename,
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
        const rowClassName = cn(
          'flex w-full items-center gap-1.5 truncate text-left text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground',
          isSidebar ? sidebarRowClassName : 'rounded px-2 py-1.5'
        )
        const rowContent = (
          <>
            <StatusIndicator
              status={config.indicatorStatus}
              variant={config.indicatorVariant}
              shape={config.indicatorShape}
              label={config.label}
              className="h-1.5 w-1.5 shrink-0"
            />
            {isRenaming ? (
              <input
                ref={renameInputRef}
                type="text"
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onBlur={() => submitRename(session.name)}
                onKeyDown={e => handleRenameKeyDown(e, session.name)}
                onClick={e => e.stopPropagation()}
                className="w-full min-w-0 bg-transparent text-xs outline-none"
              />
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
                {showStarGlyph && starredIds.has(shortcut.sessionId) && (
                  <StarGlyph />
                )}
                {showPinGlyph &&
                  pinnedKeys.has(
                    `${shortcut.projectId}/${shortcut.sessionId}`
                  ) && <PinGlyph />}
                <span className="shrink-0 truncate text-[10px] text-muted-foreground/70">
                  {shortcut.context}
                </span>
                {card.label && (
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                    style={{
                      backgroundColor: card.label.color,
                      color: getLabelTextColor(card.label.color),
                    }}
                  >
                    {card.label.name}
                  </span>
                )}
              </>
            )}
          </>
        )

        return (
          <ContextMenu key={shortcut.sessionId}>
            <ContextMenuTrigger asChild>
              {isRenaming ? (
                // An <input> cannot live inside a <button>, so the row
                // degrades to a plain container while renaming.
                <div
                  onContextMenuCapture={closeOpenSessionContextMenus}
                  className={rowClassName}
                >
                  {rowContent}
                </div>
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
