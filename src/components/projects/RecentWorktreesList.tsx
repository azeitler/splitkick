import { useCallback, useMemo, useState } from 'react'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronUp } from '@/components/icons/reicon'
import { invoke } from '@/lib/transport'
import { useIsMobile } from '@/hooks/use-mobile'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import {
  fetchAndSeedProjectBootstrap,
  projectsQueryKeys,
} from '@/services/projects'
import { chatQueryKeys } from '@/services/chat'
import { isFolder, type Project, type Worktree } from '@/types/projects'
import type { WorktreeSessions } from '@/types/chat'
import { getSessionActivityTimestamp } from './worktree-sort-utils'
import { buildRecentWorktreeRows } from './recent-worktrees'

const INITIAL_RECENT_LIMIT = 10

interface RecentWorktreesListProps {
  projects: Project[]
}

export function RecentWorktreesList({ projects }: RecentWorktreesListProps) {
  const queryClient = useQueryClient()
  const isMobile = useIsMobile()
  const selectProject = useProjectsStore(state => state.selectProject)
  const selectWorktree = useProjectsStore(state => state.selectWorktree)
  const [showAll, setShowAll] = useState(false)
  const availableProjects = useMemo(
    () => projects.filter(project => !isFolder(project) && !project.offline),
    [projects]
  )

  const worktreeQueries = useQueries({
    queries: availableProjects.map(project => ({
      queryKey: projectsQueryKeys.bootstrap(project.id),
      queryFn: () => fetchAndSeedProjectBootstrap(project.id, queryClient),
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 2,
    })),
  })

  const worktreeEntries = useMemo(
    () =>
      availableProjects.flatMap((project, index) =>
        (worktreeQueries[index]?.data ?? []).map(worktree => ({
          project,
          worktree,
        }))
      ),
    [availableProjects, worktreeQueries]
  )

  const sessionQueries = useQueries({
    queries: worktreeEntries.map(({ worktree }) => ({
      queryKey: chatQueryKeys.sessions(worktree.id),
      queryFn: () =>
        invoke<WorktreeSessions>('get_sessions', {
          worktreeId: worktree.id,
          worktreePath: worktree.path,
          includeMessageCounts: false,
        }),
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 2,
    })),
  })

  const rows = useMemo(() => {
    const worktreesByProject = new Map<string, Worktree[]>()
    for (const { project, worktree } of worktreeEntries) {
      const current = worktreesByProject.get(project.id) ?? []
      worktreesByProject.set(project.id, [...current, worktree])
    }
    const sessionsByWorktree = new Map<string, WorktreeSessions>()
    worktreeEntries.forEach(({ worktree }, index) => {
      const sessions = sessionQueries[index]?.data
      if (sessions) sessionsByWorktree.set(worktree.id, sessions)
    })
    return buildRecentWorktreeRows(
      availableProjects,
      worktreesByProject,
      sessionsByWorktree
    )
  }, [availableProjects, sessionQueries, worktreeEntries])

  const handleOpen = useCallback(
    (row: (typeof rows)[number]) => {
      selectProject(row.project.id)
      selectWorktree(row.worktree.id)
      useChatStore.getState().clearActiveWorktree()

      const activeSessions = row.sessions.sessions.filter(
        session => !session.archived_at
      )
      const targetSession = [...activeSessions].sort(
        (a, b) =>
          getSessionActivityTimestamp(b) - getSessionActivityTimestamp(a)
      )[0]
      if (targetSession) {
        useChatStore
          .getState()
          .setActiveSession(row.worktree.id, targetSession.id)
      }
      window.setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent('open-session-modal', {
            detail: {
              sessionId: targetSession?.id ?? '',
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

  const isLoading =
    worktreeQueries.some(query => query.isLoading) ||
    sessionQueries.some(query => query.isLoading)
  const visibleRows = showAll ? rows : rows.slice(0, INITIAL_RECENT_LIMIT)
  const hiddenCount = Math.max(0, rows.length - INITIAL_RECENT_LIMIT)

  if (isLoading && rows.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-xs text-muted-foreground">
        Loading recent worktrees…
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-xs text-muted-foreground">
        No prompted worktrees yet
      </div>
    )
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-y-auto"
      data-testid="recent-worktrees-list"
    >
      <div className="divide-y divide-border/30">
        {visibleRows.map(row => (
          <button
            key={row.worktree.id}
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/50"
            onClick={() => handleOpen(row)}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
                {row.project.name}
              </span>
              <span className="block truncate text-sm text-foreground">
                {row.worktree.name}
              </span>
            </span>
            {(row.added > 0 || row.removed > 0) && (
              <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium">
                <span className="text-green-500">+{row.added}</span>
                <span className="text-red-500">-{row.removed}</span>
              </span>
            )}
          </button>
        ))}
      </div>
      {hiddenCount > 0 && (
        <button
          type="button"
          className="mx-3 mb-2 mt-2 flex h-8 items-center justify-center gap-1 rounded-md text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          onClick={() => setShowAll(value => !value)}
          aria-expanded={showAll}
        >
          {showAll ? (
            <>
              Show first 10 <ChevronUp className="size-3.5" />
            </>
          ) : (
            <>
              Show {hiddenCount} more <ChevronDown className="size-3.5" />
            </>
          )}
        </button>
      )}
    </div>
  )
}
