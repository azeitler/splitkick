import { useCallback, useMemo, type ReactNode } from 'react'
import { Archive, Folder, Layers } from 'lucide-react'
import { useIsMobile } from '@/hooks/use-mobile'
import { openArchivedView } from '@/lib/archived-view'
import { cn } from '@/lib/utils'
import { useAllArchivedSessions } from '@/services/chat'
import { useArchivedWorktrees, useProjects } from '@/services/projects'
import { useUIStore } from '@/store/ui-store'
import { SidebarTabEmpty } from './SidebarTabEmpty'
import {
  SIDEBAR_PROJECT_ROW_PADDING,
  SIDEBAR_ROW_SELECTED,
  SIDEBAR_ROW_SHAPE,
} from './sidebar-row-styles'

export interface ArchivedProjectRow {
  projectId: string
  name: string
  count: number
}

/**
 * The projects that have archived worktrees or sessions, with their counts,
 * by name. A project that no longer exists shows as "Unknown project".
 */
export function archivedProjectRows(
  worktreeProjectIds: string[],
  sessionProjectIds: string[],
  projectNames: ReadonlyMap<string, string>
): ArchivedProjectRow[] {
  const counts = new Map<string, number>()
  for (const id of [...worktreeProjectIds, ...sessionProjectIds]) {
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return [...counts]
    .map(([projectId, count]) => ({
      projectId,
      name: projectNames.get(projectId) || 'Unknown project',
      count,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The sidebar's Archived tab: "All projects", then every project that has
 * archived items. A row opens the Archived view in the main area, filtered
 * to that project, where items are restored or deleted.
 */
export function SidebarArchivedSection() {
  const isMobile = useIsMobile()
  const openProjectId = useUIStore(state =>
    state.archivedViewOpen ? state.archivedViewProjectId : undefined
  )
  const { data: worktrees } = useArchivedWorktrees()
  const { data: sessions } = useAllArchivedSessions()
  const { data: projects } = useProjects()

  const rows = useMemo(
    () =>
      archivedProjectRows(
        (worktrees ?? []).map(w => w.project_id),
        (sessions ?? []).map(s => s.project_id),
        new Map((projects ?? []).map(p => [p.id, p.name]))
      ),
    [worktrees, sessions, projects]
  )
  const total = rows.reduce((sum, row) => sum + row.count, 0)

  const handleOpen = useCallback(
    (projectId: string | null) => {
      openArchivedView(projectId)
      if (isMobile) useUIStore.getState().setLeftSidebarVisible(false)
    },
    [isMobile]
  )

  if (rows.length === 0) {
    return (
      <SidebarTabEmpty
        icon={<Archive />}
        title="Nothing archived"
        hint="Archived worktrees and sessions show here."
        testId="sidebar-archived-empty"
      />
    )
  }

  return (
    <div data-testid="sidebar-archived-section" className="py-0.5">
      <SidebarArchivedRow
        testId="sidebar-archived-all"
        icon={<Layers />}
        name="All projects"
        count={total}
        selected={openProjectId === null}
        onClick={() => handleOpen(null)}
      />
      {rows.map(row => (
        <SidebarArchivedRow
          key={row.projectId}
          testId={`sidebar-archived-project-${row.projectId}`}
          icon={<Folder />}
          name={row.name}
          count={row.count}
          selected={openProjectId === row.projectId}
          onClick={() => handleOpen(row.projectId)}
        />
      ))}
    </div>
  )
}

function SidebarArchivedRow({
  testId,
  icon,
  name,
  count,
  selected,
  onClick,
}: {
  testId: string
  icon: ReactNode
  name: string
  count: number
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? 'page' : undefined}
      data-testid={testId}
      className={cn(
        'flex cursor-pointer items-center gap-1.5 py-1.5 text-left text-sm transition-colors duration-150 [&_svg]:size-3.5 [&_svg]:shrink-0',
        SIDEBAR_ROW_SHAPE,
        SIDEBAR_PROJECT_ROW_PADDING,
        selected
          ? SIDEBAR_ROW_SELECTED
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
      )}
    >
      <span aria-hidden="true" className="contents">
        {icon}
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 truncate',
          selected ? 'text-foreground' : 'text-foreground/90'
        )}
      >
        {name}
      </span>
      <span
        aria-label={`${count} archived`}
        className="shrink-0 pr-1 text-[11px] tabular-nums text-muted-foreground"
      >
        {count}
      </span>
    </button>
  )
}
