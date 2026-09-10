import { Pin } from 'lucide-react'
import { useSidebarWidth } from '@/components/layout/SidebarWidthContext'
import { cn } from '@/lib/utils'
import {
  SessionShortcutRows,
  type SessionShortcut,
} from './SessionShortcutRows'
import { SidebarSectionRow } from './SidebarSectionRow'
import type { SessionCardData } from './session-card-utils'
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
 * The rows and their shared session menu live in `SessionShortcutRows`, which
 * the Starred section uses as well.
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

  if (rows.length === 0) return null

  const isSidebar = variant === 'sidebar'
  // Matches WorktreeItem, so the two rows indent alike as the sidebar narrows.
  const isNarrowSidebar = sidebarWidth < 200
  const isOpen = !isSidebar || expanded

  const shortcuts: SessionShortcut[] = rows.map(({ row, card }) => ({
    sessionId: row.sessionId,
    projectId,
    worktreeId: row.worktreeId,
    worktreePath: row.worktreePath,
    session: row.session,
    card,
    context: row.worktreeName,
  }))

  const handleOpen = (shortcut: SessionShortcut) => {
    const pinned = rows.find(({ row }) => row.sessionId === shortcut.sessionId)
    if (pinned) onOpen(pinned.row)
  }

  return (
    <div
      // The sidebar host supplies the tree indent and left border. Spacing comes
      // from being an ordinary row, so this variant adds no separator.
      className={cn(!isSidebar && 'mb-3')}
      data-testid="pinned-sessions-section"
    >
      {isSidebar ? (
        // A workspace-style row, so the pinned block reads as a sibling of the
        // workspaces rather than a caption pasted above them.
        <SidebarSectionRow
          icon={<Pin className="size-2.5 shrink-0" />}
          label="Pinned"
          count={rows.length}
          expanded={expanded}
          onToggle={onToggleExpanded}
          className={isNarrowSidebar ? 'pl-4' : 'pl-7'}
        />
      ) : (
        <div className="flex items-center gap-1.5 px-1 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
          <Pin className="size-3 shrink-0" />
          <span>Pinned</span>
          <span className="text-muted-foreground/60">{rows.length}</span>
        </div>
      )}

      {isOpen && (
        <SessionShortcutRows
          shortcuts={shortcuts}
          variant={variant}
          onOpen={handleOpen}
        />
      )}
    </div>
  )
}
