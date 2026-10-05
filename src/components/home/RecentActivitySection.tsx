import { memo, useCallback, useState } from 'react'
import {
  CheckCircle2,
  ChevronRight,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequestArrow,
  GitPullRequestClosed,
  OctagonX,
  ScanEye,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { openUrl } from '@tauri-apps/plugin-opener'
import { formatRelativeTime } from '@/lib/relative-time'
import { navigateToProject, navigateToSession } from '@/lib/navigate-to-session'
import { useRecentActivity } from '@/services/activity'
import type { ActivityEvent, ActivityKind } from '@/types/activity'

interface KindPresentation {
  icon: LucideIcon
  /** Fixed wording. The record's `title` carries the detail. */
  label: string
  className: string
}

const KIND_PRESENTATION: Record<ActivityKind, KindPresentation> = {
  session_completed: {
    icon: CheckCircle2,
    label: 'Session finished',
    className: 'text-green-600 dark:text-green-400',
  },
  session_cancelled: {
    icon: XCircle,
    label: 'Session stopped',
    className: 'text-muted-foreground',
  },
  session_crashed: {
    icon: OctagonX,
    label: 'Session crashed',
    className: 'text-red-600 dark:text-red-400',
  },
  commit_created: {
    icon: GitCommitHorizontal,
    label: 'Commit',
    className: 'text-muted-foreground',
  },
  pr_opened: {
    icon: GitPullRequestArrow,
    label: 'PR opened',
    className: 'text-blue-600 dark:text-blue-400',
  },
  pr_merged: {
    icon: GitMerge,
    label: 'PR merged',
    className: 'text-purple-600 dark:text-purple-400',
  },
  pr_closed: {
    icon: GitPullRequestClosed,
    label: 'PR closed',
    className: 'text-muted-foreground',
  },
  review_finished: {
    icon: ScanEye,
    label: 'Review finished',
    className: 'text-amber-600 dark:text-amber-400',
  },
}

interface RecentActivitySectionProps {
  /**
   * Narrow the feed to one project. The backend filters before it applies the
   * limit, so a quiet project still fills its own feed.
   */
  projectId?: string
}

/**
 * The activity feed, closed until asked for.
 *
 * The feed is mostly "Session finished" rows, which the session list above it
 * already says. It stays one click away rather than taking a column.
 */
export const RecentActivitySection = memo(function RecentActivitySection({
  projectId,
}: RecentActivitySectionProps = {}) {
  const [open, setOpen] = useState(false)

  return (
    <section className="flex w-full min-w-0 flex-col gap-2">
      <h2 className="text-sm font-semibold text-foreground">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(value => !value)}
          className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronRight
            className={cn(
              'size-3.5 shrink-0 transition-transform',
              open && 'rotate-90'
            )}
            aria-hidden="true"
          />
          Recent activity
        </button>
      </h2>
      {/* Mounted only while open, so a closed section loads nothing. */}
      {open && <ActivityFeed projectId={projectId} />}
    </section>
  )
})

function ActivityFeed({ projectId }: RecentActivitySectionProps) {
  const { data, isLoading, isError, refetch } = useRecentActivity({ projectId })
  const events = data ?? []

  // A failed refetch keeps the events already loaded, so only a feed that never
  // loaded shows the error. Every `activity:appended` refetches, and one miss
  // (a web-access reconnect, say) must not blank a feed that was fine.
  if (isError && !data) {
    return (
      <p className="text-sm text-muted-foreground">
        Could not load activity.{' '}
        <button
          type="button"
          onClick={() => void refetch()}
          className="underline underline-offset-2 transition-colors hover:text-foreground"
        >
          Retry
        </button>
      </p>
    )
  }

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading activity…</p>
  }

  if (events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing yet. Finished sessions, commits, pull requests, and reviews show
        here.
      </p>
    )
  }

  return (
    <ul className="flex flex-col divide-y divide-border/60 rounded-md border bg-muted/20">
      {events.map(event => (
        <ActivityRow
          key={event.id}
          event={event}
          hideProjectName={!!projectId}
        />
      ))}
    </ul>
  )
}

function ActivityRow({
  event,
  hideProjectName = false,
}: {
  event: ActivityEvent
  /** Drop the project name from line 2. Set where every row is one project. */
  hideProjectName?: boolean
}) {
  const presentation = KIND_PRESENTATION[event.kind]
  const Icon = presentation.icon

  const target = describeTarget(event, hideProjectName)

  const handleOpen = useCallback(() => {
    // A session is the most useful place to land. Fall back to the project, and
    // to the pull request page when Jean has nothing local to open.
    if (event.sessionId && event.worktreeId && event.projectId) {
      navigateToSession({
        projectId: event.projectId,
        worktreeId: event.worktreeId,
        sessionId: event.sessionId,
      })
      return
    }
    if (event.projectId) {
      navigateToProject(event.projectId)
      return
    }
    if (event.url) void openUrl(event.url)
  }, [event])

  // Same two-line grid as the session rows: what happened and when on top,
  // where it happened underneath.
  return (
    <li>
      <button
        type="button"
        onClick={handleOpen}
        className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0.5 px-3 py-2 text-left transition-colors hover:bg-accent/50"
      >
        <Icon
          className={cn('size-3.5 shrink-0', presentation.className)}
          aria-hidden="true"
        />

        <span className="flex min-w-0 items-baseline gap-1.5 text-sm">
          <span className="shrink-0">{presentation.label}</span>
          {event.title && (
            <span className="min-w-0 truncate text-muted-foreground">
              {event.title}
            </span>
          )}
        </span>

        <span className="w-14 text-right text-xs tabular-nums text-muted-foreground">
          {formatRelativeTime(event.at)}
        </span>

        {target && (
          <span className="col-start-2 col-end-4 truncate text-xs text-muted-foreground">
            {target}
          </span>
        )}
      </button>
    </li>
  )
}

/** "project / worktree", skipping whichever part the record lacks. */
function describeTarget(
  event: ActivityEvent,
  hideProjectName: boolean
): string {
  return [
    hideProjectName ? undefined : event.projectName,
    event.sessionName ?? event.worktreeName,
  ]
    .filter(Boolean)
    .join(' / ')
}
