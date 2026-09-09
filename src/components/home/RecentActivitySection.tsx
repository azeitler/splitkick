import { memo, useCallback } from 'react'
import {
  CheckCircle2,
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
import {
  navigateToProject,
  navigateToSession,
} from '@/lib/navigate-to-session'
import { useRecentActivity } from '@/services/activity'
import type { ActivityEvent, ActivityKind } from '@/types/activity'
import { HomeSection } from './RecentSessionsSection'

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

export const RecentActivitySection = memo(function RecentActivitySection() {
  const { data: events = [], isLoading } = useRecentActivity()

  if (isLoading) {
    return (
      <HomeSection title="Recent activity">
        <p className="text-sm text-muted-foreground">Loading activity…</p>
      </HomeSection>
    )
  }

  if (events.length === 0) {
    return (
      <HomeSection title="Recent activity">
        <p className="text-sm text-muted-foreground">
          Nothing yet. Finished sessions, commits, pull requests, and reviews
          show here.
        </p>
      </HomeSection>
    )
  }

  return (
    <HomeSection title="Recent activity">
      <ul className="flex flex-col divide-y divide-border/60 rounded-md border bg-muted/20">
        {events.map(event => (
          <ActivityRow key={event.id} event={event} />
        ))}
      </ul>
    </HomeSection>
  )
})

function ActivityRow({ event }: { event: ActivityEvent }) {
  const presentation = KIND_PRESENTATION[event.kind]
  const Icon = presentation.icon

  const target = describeTarget(event)

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

  return (
    <li>
      <button
        type="button"
        onClick={handleOpen}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-accent/50"
      >
        <Icon
          className={cn('size-3.5 shrink-0', presentation.className)}
          aria-hidden="true"
        />

        <span className="shrink-0 text-sm">{presentation.label}</span>

        {event.title && (
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
            {event.title}
          </span>
        )}

        <span
          className={cn(
            'hidden min-w-0 truncate text-xs text-muted-foreground sm:block sm:max-w-[16rem]',
            event.title ? 'shrink-0' : 'flex-1'
          )}
        >
          {target}
        </span>

        <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {formatRelativeTime(event.at)}
        </span>
      </button>
    </li>
  )
}

/** "project / worktree", skipping whichever part the record lacks. */
function describeTarget(event: ActivityEvent): string {
  return [event.projectName, event.sessionName ?? event.worktreeName]
    .filter(Boolean)
    .join(' / ')
}
