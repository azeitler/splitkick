import { useState } from 'react'
import { ChevronDown, Pin } from 'lucide-react'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { CollapsedCountBadge } from '@/components/projects/CollapsedCountBadge'
import { useSidebarWidth } from '@/components/layout/SidebarWidthContext'
import { StatusIndicator } from '@/components/ui/status-indicator'
import { getLabelTextColor } from '@/lib/label-colors'
import { cn } from '@/lib/utils'
import { usePreferences } from '@/services/preferences'
import { useChatStore } from '@/store/chat-store'
import { LabelModal } from './LabelModal'
import { useSessionRemoval } from './hooks/useSessionArchive'
import { useSessionRename } from './hooks/useSessionRename'
import {
  SessionContextMenuItems,
  closeOpenSessionContextMenus,
} from './SessionContextMenuItems'
import { statusConfig, type SessionCardData } from './session-card-utils'
import type { PinnedSessionRow } from './pinned-sessions'

export interface PinnedSessionEntryRow {
  row: PinnedSessionRow
  card: SessionCardData
}

interface PinnedSessionsSectionProps {
  rows: PinnedSessionEntryRow[]
  /** `canvas` sits above the worktree sections; `sidebar` sits under the project row. */
  variant: 'canvas' | 'sidebar'
  /** Project owning the pins. Drives the menu's pin/unpin item. */
  projectId: string
  /** Sidebar only: whether the pinned row shows its sessions. Canvas is always open. */
  expanded?: boolean
  /** Sidebar only: toggles `expanded`. Without it the row keeps no disclosure. */
  onToggleExpanded?: () => void
  onOpen: (row: PinnedSessionRow) => void
}

/**
 * Sessions the user pinned to the project root, shown on the project canvas and
 * in the sidebar tree. Rows stay out of the canvas keyboard navigation, which
 * indexes worktree sections. The sidebar parent is a real tree row, so it is a
 * native button and answers Enter and Space; that is browser focus, not the
 * canvas index.
 *
 * A pinned row carries the same context menu as the session's row under its
 * workspace (`SessionContextMenuItems`). Because pinned rows come from several
 * worktrees, rename and removal take their target per call — see
 * `useSessionRename` and `useSessionRemoval`.
 */
export function PinnedSessionsSection({
  rows,
  variant,
  projectId,
  expanded = true,
  onToggleExpanded,
  onOpen,
}: PinnedSessionsSectionProps) {
  const sidebarWidth = useSidebarWidth()
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

  if (rows.length === 0) return null

  const isSidebar = variant === 'sidebar'
  // Matches WorktreeItem, so the two rows indent alike as the sidebar narrows.
  const isNarrowSidebar = sidebarWidth < 200
  const isOpen = !isSidebar || expanded

  const parent = isSidebar ? (
    // A workspace-style row, so the pinned block reads as a sibling of the
    // workspaces rather than a caption pasted above them.
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onToggleExpanded}
      className={cn(
        'group relative flex w-full cursor-pointer items-center gap-1.5 overflow-hidden py-1.5 pr-2 text-left text-muted-foreground transition-colors duration-150 hover:bg-accent/50 hover:text-foreground',
        isNarrowSidebar ? 'pl-4' : 'pl-7'
      )}
    >
      <Pin className="size-2.5 shrink-0" />
      <span className="flex flex-1 items-center gap-0.5 truncate text-sm">
        <span className="truncate">Pinned</span>
        {!expanded && (
          <CollapsedCountBadge count={rows.length} noun="session" />
        )}
        <span className="flex size-4 shrink-0 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-50">
          <ChevronDown
            className={cn(
              'size-3 transition-transform',
              expanded && 'rotate-180'
            )}
          />
        </span>
      </span>
    </button>
  ) : (
    <div className="flex items-center gap-1.5 px-1 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
      <Pin className="size-3 shrink-0" />
      <span>Pinned</span>
      <span className="text-muted-foreground/60">{rows.length}</span>
    </div>
  )

  return (
    <div
      // The sidebar host supplies the tree indent and left border. Spacing comes
      // from being an ordinary row, so this variant adds no separator.
      className={cn(!isSidebar && 'mb-3')}
      data-testid="pinned-sessions-section"
    >
      {parent}

      {isOpen &&
        rows.map(({ row, card }) => {
          const config = statusConfig[card.status]
          const isRenaming = renamingSessionId === row.sessionId
          const rowClassName = cn(
            'flex w-full items-center gap-1.5 truncate text-left text-sm text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            isSidebar ? 'py-1 pl-5 pr-2' : 'rounded px-2 py-1.5'
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
                  onBlur={() => submitRename(row.session.name)}
                  onKeyDown={e => handleRenameKeyDown(e, row.session.name)}
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
                    {row.session.name}
                  </span>
                  <span className="shrink-0 truncate text-[10px] text-muted-foreground/70">
                    {row.worktreeName}
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
            <ContextMenu key={row.sessionId}>
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
                    onClick={() => onOpen(row)}
                    onContextMenuCapture={closeOpenSessionContextMenus}
                    title={`${row.session.name} — ${row.worktreeName}`}
                    className={rowClassName}
                  >
                    {rowContent}
                  </button>
                )}
              </ContextMenuTrigger>
              <SessionContextMenuItems
                card={card}
                worktreeId={row.worktreeId}
                projectId={projectId}
                contentClassName="w-56"
                onRename={(sessionId, currentName) =>
                  startRename({
                    sessionId,
                    currentName,
                    worktreeId: row.worktreeId,
                    worktreePath: row.worktreePath,
                  })
                }
                onManageLabels={sessionId => {
                  setLabelTargetSessionId(sessionId)
                  setLabelModalOpen(true)
                }}
                onArchive={sessionId =>
                  archive({
                    worktreeId: row.worktreeId,
                    worktreePath: row.worktreePath,
                    sessionId,
                  })
                }
                onDelete={sessionId =>
                  remove({
                    worktreeId: row.worktreeId,
                    worktreePath: row.worktreePath,
                    sessionId,
                  })
                }
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
    </div>
  )
}
