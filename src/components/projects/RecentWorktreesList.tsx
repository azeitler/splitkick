import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { AlertTriangle, Plus } from '@/components/icons/reicon'
import { useIsMobile } from '@/hooks/use-mobile'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import { fetchRecentWorktrees } from '@/services/projects'
import type { Project, RecentWorktreeItem } from '@/types/projects'

const INITIAL_RECENT_LIMIT = 10
const RECENT_PAGE_SIZE = 25

interface RecentWorktreesListProps {
  projects: Project[]
}

export function formatRecentActivity(
  timestamp: number,
  now = Date.now()
): string {
  const seconds = Math.max(0, Math.floor((now - timestamp * 1000) / 1000))
  if (seconds < 60) return 'now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return days < 30 ? `${days}d` : `${Math.floor(days / 30)}mo`
}

function ignoresNavigationShortcut(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  )
}

export function RecentWorktreesList({ projects }: RecentWorktreesListProps) {
  const isMobile = useIsMobile()
  const selectProject = useProjectsStore(state => state.selectProject)
  const selectWorktree = useProjectsStore(state => state.selectWorktree)
  const selectedWorktreeId = useProjectsStore(state => state.selectedWorktreeId)
  const selectedSessionId = useChatStore(state =>
    selectedWorktreeId
      ? (state.activeSessionIds[selectedWorktreeId] ?? null)
      : null
  )
  const [limit, setLimit] = useState(INITIAL_RECENT_LIMIT)
  const rowRefs = useRef(new Map<string, HTMLButtonElement>())
  const projectKey = useMemo(
    () =>
      projects
        .map(project => project.id)
        .sort()
        .join('\0'),
    [projects]
  )

  useEffect(() => setLimit(INITIAL_RECENT_LIMIT), [projectKey])

  const query = useQuery({
    queryKey: ['recent-worktrees', projectKey, limit, selectedSessionId],
    queryFn: () => fetchRecentWorktrees(projects, limit, selectedSessionId),
    enabled: projects.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
  const rows = query.data?.items ?? []

  const handleOpen = useCallback(
    (row: RecentWorktreeItem) => {
      selectProject(row.projectId)
      selectWorktree(row.worktree.id)
      useChatStore.getState().clearActiveWorktree()
      useChatStore.getState().setActiveSession(row.worktree.id, row.session.id)
      window.setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('open-session-modal', {
            detail: {
              sessionId: row.session.id,
              worktreeId: row.worktree.id,
              worktreePath: row.worktree.path,
            },
          })
        )
      }, 50)
      if (isMobile) useUIStore.getState().setLeftSidebarVisible(false)
    },
    [isMobile, selectProject, selectWorktree]
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey || !['ArrowUp', 'ArrowDown'].includes(event.key))
        return
      if (ignoresNavigationShortcut(event.target) || rows.length === 0) return
      event.preventDefault()
      const current = rows.findIndex(
        row => row.session.id === selectedSessionId
      )
      const direction = event.key === 'ArrowDown' ? 1 : -1
      const nextIndex =
        current < 0
          ? direction > 0
            ? 0
            : rows.length - 1
          : Math.min(rows.length - 1, Math.max(0, current + direction))
      const row = rows[nextIndex]
      if (!row) return
      handleOpen(row)
      rowRefs.current.get(row.session.id)?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleOpen, rows, selectedSessionId])

  if (query.isPending) {
    return (
      <div
        role="status"
        className="px-3 py-6 text-center text-xs text-muted-foreground"
      >
        Loading recent sessions…
      </div>
    )
  }

  if (query.isError && rows.length === 0) {
    return (
      <div
        role="alert"
        className="flex flex-col items-center gap-2 px-3 py-6 text-center text-xs text-muted-foreground"
      >
        <AlertTriangle className="size-4 text-destructive" />
        <span>Unable to load recent sessions</span>
        <button
          type="button"
          className="text-primary hover:underline"
          onClick={() => void query.refetch()}
        >
          Retry
        </button>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-xs text-muted-foreground">
        No prompted sessions yet
      </div>
    )
  }

  const failedCount =
    (query.data?.failedServerIds.length ?? 0) +
    (query.data?.failedWorktreeIds.length ?? 0)
  const hiddenCount = Math.max(0, (query.data?.total ?? rows.length) - limit)

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden"
      data-testid="recent-worktrees-list"
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ul aria-label="Recent sessions" className="divide-y divide-border/30">
          {rows.map(row => {
            const isCurrent = row.session.id === selectedSessionId
            const activity = formatRecentActivity(row.lastActivityAt)
            const activityLabel =
              activity === 'now' ? 'active now' : `active ${activity} ago`
            return (
              <li key={row.session.id}>
                <button
                  ref={element => {
                    if (element) rowRefs.current.set(row.session.id, element)
                    else rowRefs.current.delete(row.session.id)
                  }}
                  type="button"
                  aria-current={isCurrent ? 'page' : undefined}
                  aria-label={`${row.session.name}, ${row.projectName}, ${row.worktree.name}, ${activityLabel}`}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring ${isCurrent ? 'bg-muted/60 text-foreground' : 'text-muted-foreground'}`}
                  onClick={() => handleOpen(row)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {row.session.name}
                    </span>
                    <span className="block truncate text-xs">
                      {row.projectName} · {row.worktree.name}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-0.5 text-[11px] tabular-nums">
                    <time
                      dateTime={new Date(
                        row.lastActivityAt * 1000
                      ).toISOString()}
                    >
                      {activity}
                    </time>
                    {(row.added > 0 || row.removed > 0) && (
                      <span className="flex gap-1 font-medium">
                        <span className="text-green-500">+{row.added}</span>
                        <span className="text-red-500">-{row.removed}</span>
                      </span>
                    )}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
      {(hiddenCount > 0 || failedCount > 0 || query.isFetching) && (
        <div className="shrink-0 border-t border-border/40 p-2">
          {hiddenCount > 0 && (
            <button
              type="button"
              className="flex h-8 w-full items-center justify-center gap-1 rounded-md text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              onClick={() => setLimit(value => value + RECENT_PAGE_SIZE)}
            >
              <Plus className="size-3.5" /> Show{' '}
              {Math.min(hiddenCount, RECENT_PAGE_SIZE)} more
            </button>
          )}
          {failedCount > 0 && (
            <div
              role="status"
              className="flex items-center justify-center gap-1 text-[11px] text-amber-600"
            >
              <AlertTriangle className="size-3" /> Some recent sessions could
              not load.{' '}
              <button
                type="button"
                className="underline"
                onClick={() => void query.refetch()}
              >
                Retry
              </button>
            </div>
          )}
          {query.isFetching && !query.isPending && (
            <div
              role="status"
              className="text-center text-[11px] text-muted-foreground"
            >
              Updating…
            </div>
          )}
        </div>
      )}
    </div>
  )
}
