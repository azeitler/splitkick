import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { AlertTriangle, Plus } from '@/components/icons/reicon'
import { useIsMobile } from '@/hooks/use-mobile'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import { fetchRecentWorktrees } from '@/services/projects'
import { fetchWorktreesStatus } from '@/services/git-status'
import type { Project, RecentWorktreeItem } from '@/types/projects'
import { getRecentSessionStatus } from './recent-session-status'

const INITIAL_RECENT_LIMIT = 10
const RECENT_PAGE_SIZE = 25
const SNOOZE_AFTER_SECONDS = 24 * 60 * 60

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

export function isSnoozedSession(
  lastActivityAt: number,
  now = Date.now()
): boolean {
  return lastActivityAt <= Math.floor(now / 1000) - SNOOZE_AFTER_SECONDS
}

export function getAdjacentRecentRow(
  rows: RecentWorktreeItem[],
  selectedSessionId: string | null,
  direction: 1 | -1
): RecentWorktreeItem | undefined {
  if (rows.length === 0) return undefined

  const current = rows.findIndex(row => row.session.id === selectedSessionId)
  const nextIndex =
    current < 0
      ? direction > 0
        ? 0
        : rows.length - 1
      : Math.min(rows.length - 1, Math.max(0, current + direction))
  return rows[nextIndex]
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
  const sendingSessionIds = useChatStore(state => state.sendingSessionIds)
  const waitingForInputSessionIds = useChatStore(
    state => state.waitingForInputSessionIds
  )
  const namingSessionIds = useChatStore(state => state.namingSessionIds)
  const executionModes = useChatStore(state => state.executionModes)
  const executingModes = useChatStore(state => state.executingModes)
  const [limit, setLimit] = useState(INITIAL_RECENT_LIMIT)
  const [showSnoozed, setShowSnoozed] = useState(false)
  const rowRefs = useRef(new Map<string, HTMLButtonElement>())
  const projectKey = useMemo(
    () =>
      projects
        .map(project => project.id)
        .sort()
        .join('\0'),
    [projects]
  )

  useEffect(() => {
    setLimit(INITIAL_RECENT_LIMIT)
    setShowSnoozed(false)
  }, [projectKey])

  const query = useQuery({
    // Selection only changes the highlighted row. Keep it out of the query so
    // switching sessions cannot swap between cached list variants with
    // different ordering.
    queryKey: ['recent-worktrees', projectKey, limit],
    queryFn: () => fetchRecentWorktrees(projects, limit, null),
    enabled: projects.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
  const rows = query.data?.items ?? []
  const snoozedBoundaryLoaded = rows
    .slice(0, limit)
    .some(row => isSnoozedSession(row.lastActivityAt))
  const displayedRows = showSnoozed
    ? rows
    : rows.filter(row => !isSnoozedSession(row.lastActivityAt))
  const recentProjectKey = useMemo(
    () => [...new Set(rows.map(row => row.projectId))].sort().join('\0'),
    [rows]
  )

  useEffect(() => {
    if (!recentProjectKey) return
    void Promise.allSettled(
      recentProjectKey
        .split('\0')
        .map(projectId =>
          fetchWorktreesStatus(projectId).catch(() => undefined)
        )
    )
  }, [recentProjectKey])

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
      event.preventDefault()
      event.stopPropagation()
      const row = getAdjacentRecentRow(
        displayedRows,
        selectedSessionId,
        event.key === 'ArrowDown' ? 1 : -1
      )
      if (!row) return
      handleOpen(row)
      rowRefs.current.get(row.session.id)?.focus()
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () =>
      window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [displayedRows, handleOpen, selectedSessionId])

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
        <ul
          aria-label="Recent sessions"
          className="flex flex-col gap-2 px-2 py-2"
        >
          {displayedRows.map((row, index) => {
            const isCurrent = row.session.id === selectedSessionId
            const activity = formatRecentActivity(row.lastActivityAt)
            const activityLabel =
              activity === 'now' ? 'active now' : `active ${activity} ago`
            const status = getRecentSessionStatus(row.session, {
              sending: sendingSessionIds[row.session.id] ?? false,
              waiting: waitingForInputSessionIds[row.session.id] ?? false,
            })
            const statusClassName =
              status.tone === 'waiting'
                ? 'text-amber-600 dark:text-amber-400'
                : status.tone === 'failed'
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-muted-foreground'
            const statusBorderClassName =
              status.tone === 'working'
                ? (executingModes[row.session.id] ??
                    executionModes[row.session.id] ??
                    row.session.last_run_execution_mode ??
                    row.session.selected_execution_mode) === 'yolo'
                  ? 'border-l-destructive'
                  : 'border-l-yellow-500'
                : status.tone === 'completed'
                  ? 'border-l-green-500'
                  : 'border-l-transparent'
            return (
              <li key={row.session.id}>
                {showSnoozed &&
                  isSnoozedSession(row.lastActivityAt) &&
                  (index === 0 ||
                    !isSnoozedSession(
                      displayedRows[index - 1]?.lastActivityAt ?? 0
                    )) && (
                    <div className="px-1 py-1 text-[11px] font-medium text-muted-foreground">
                      Snoozed · inactive for 24 hours
                    </div>
                  )}
                <button
                  ref={element => {
                    if (element) rowRefs.current.set(row.session.id, element)
                    else rowRefs.current.delete(row.session.id)
                  }}
                  type="button"
                  aria-current={isCurrent ? 'page' : undefined}
                  aria-label={`${row.session.name}, ${row.projectName}, ${row.worktree.name}, ${status.label}, ${activityLabel}`}
                  className={`flex w-full items-center gap-2 rounded-r-lg border border-l-2 border-transparent bg-transparent px-3 py-2.5 text-left transition-[background-color,border-color,box-shadow,color] hover:bg-muted/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${isCurrent ? 'border-border bg-muted/30 text-foreground shadow' : 'text-muted-foreground'} ${statusBorderClassName}`}
                  onClick={() => handleOpen(row)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-foreground">
                      {namingSessionIds[row.session.id]
                        ? 'Generating…'
                        : row.session.name}
                    </span>
                    <span className="block truncate text-[11px]">
                      {row.projectName} · {row.worktree.name}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-0.5 text-[10px] tabular-nums">
                    <span className="flex items-center gap-1.5">
                      {!['working', 'completed'].includes(status.tone) && (
                        <span className={`font-medium ${statusClassName}`}>
                          {status.label}
                        </span>
                      )}
                      <time
                        dateTime={new Date(
                          row.lastActivityAt * 1000
                        ).toISOString()}
                      >
                        {activity}
                      </time>
                    </span>
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
      {(hiddenCount > 0 ||
        failedCount > 0 ||
        (snoozedBoundaryLoaded && !showSnoozed)) && (
        <div className="shrink-0 border-t border-border/40 p-2">
          {hiddenCount > 0 && !snoozedBoundaryLoaded && (
            <button
              type="button"
              className="flex h-8 w-full items-center justify-center gap-1 rounded-md text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              onClick={() => setLimit(value => value + RECENT_PAGE_SIZE)}
            >
              <Plus className="size-3.5" /> Show{' '}
              {Math.min(hiddenCount, RECENT_PAGE_SIZE)} more
            </button>
          )}
          {snoozedBoundaryLoaded && !showSnoozed && (
            <button
              type="button"
              className="flex h-8 w-full items-center justify-center rounded-md text-xs text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              onClick={() => {
                setShowSnoozed(true)
                setLimit(value => value + RECENT_PAGE_SIZE)
              }}
            >
              Show snoozed sessions
            </button>
          )}
          {showSnoozed && hiddenCount > 0 && (
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
        </div>
      )}
    </div>
  )
}
