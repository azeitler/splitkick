import { Pin, Star } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  SessionShortcutRows,
  type SessionShortcut,
} from './SessionShortcutRows'
import { SidebarSectionRow } from './SidebarSectionRow'
import type { SessionCardData } from './session-card-utils'
import {
  getProjectShortcutKind,
  type ProjectShortcutKind,
  type ProjectShortcutRow,
} from './pinned-sessions'
import {
  SIDEBAR_SESSION_LIST,
  SIDEBAR_WORKTREE_SECTION_PADDING,
} from '@/components/projects/sidebar-row-styles'

const LABELS: Record<ProjectShortcutKind, string> = {
  pinned: 'Pinned',
  starred: 'Starred',
  both: 'Pinned & Starred',
}

export interface PinnedSessionEntryRow {
  row: ProjectShortcutRow
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
  onOpen: (row: ProjectShortcutRow) => void
}

/**
 * The project's top section: sessions pinned to the project root or starred in
 * this project, shown on the project canvas and in the sidebar tree. The label
 * follows the mix of rows: "Pinned", "Starred" or "Pinned & Starred" (#41). Rows stay out of the canvas keyboard navigation, which
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
  const kind = getProjectShortcutKind(rows.map(({ row }) => row))
  if (!kind) return null

  const label = LABELS[kind]
  const icon = (size: string) => (
    <span className="flex shrink-0 items-center gap-0.5">
      {kind !== 'starred' && <Pin className={size} />}
      {kind !== 'pinned' && <Star className={size} />}
    </span>
  )
  // A glyph every row carries is noise; one only some rows carry says why
  // each row is here.
  const showPinGlyph = !rows.every(({ row }) => row.isPinned)
  const showStarGlyph = !rows.every(({ row }) => row.isStarred)

  const isSidebar = variant === 'sidebar'
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
          icon={icon('size-2.5')}
          label={label}
          count={rows.length}
          expanded={expanded}
          onToggle={onToggleExpanded}
          className={SIDEBAR_WORKTREE_SECTION_PADDING}
        />
      ) : (
        <div className="flex items-center gap-1.5 px-1 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
          {icon('size-3')}
          <span>{label}</span>
          <span className="text-muted-foreground/60">{rows.length}</span>
        </div>
      )}

      {isOpen &&
        (isSidebar ? (
          // The same guide line and offset as a workspace's session list in
          // WorktreeItem, so a pinned session reads as the nested row it is.
          <div
            className={cn('py-0.5', SIDEBAR_SESSION_LIST)}
            data-testid="pinned-sessions-list"
          >
            <SessionShortcutRows
              shortcuts={shortcuts}
              variant="sidebar"
              showPinGlyph={showPinGlyph}
              showStarGlyph={showStarGlyph}
              onOpen={handleOpen}
            />
          </div>
        ) : (
          <SessionShortcutRows
            shortcuts={shortcuts}
            variant="canvas"
            showPinGlyph={showPinGlyph}
            showStarGlyph={showStarGlyph}
            onOpen={handleOpen}
          />
        ))}
    </div>
  )
}
