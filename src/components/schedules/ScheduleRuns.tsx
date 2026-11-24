import { useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { StatusIndicator } from '@/components/ui/status-indicator'
import { statusConfig } from '@/components/chat/session-card-utils'
import { formatMessageTimestamp, formatRelativeTime } from '@/lib/relative-time'
import { cn } from '@/lib/utils'
import type {
  AllSessionsResponse,
  Schedule,
  ScheduleRun,
  Session,
} from '@/types/chat'

/** Runs shown before "Show all". */
export const VISIBLE_RUNS = 10

/** The state of one scheduled run, as the Scheduled view shows it. */
export type ScheduleRunState =
  | 'running'
  | 'queued'
  | 'waiting'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'skipped'
  | 'still_queued'

/** A session with the project and workspace it is in. */
export interface SessionPlace {
  session: Session
  projectId: string
  projectName: string
  worktreeId: string
  worktreeName: string
}

/** Every session by id, with its project and workspace. */
export function sessionPlaces(
  sessions: AllSessionsResponse | undefined
): Map<string, SessionPlace> {
  const places = new Map<string, SessionPlace>()
  for (const entry of sessions?.entries ?? []) {
    for (const session of entry.sessions) {
      places.set(session.id, {
        session,
        projectId: entry.project_id,
        projectName: entry.project_name,
        worktreeId: entry.worktree_id,
        worktreeName: entry.worktree_name,
      })
    }
  }
  return places
}

/** The session's live state, for the run that is (or was last) in it. */
function liveState(session: Session): ScheduleRunState {
  if (session.last_run_status === 'running') return 'running'
  if (session.waiting_for_input) return 'waiting'
  if (session.last_run_status === 'cancelled') return 'cancelled'
  if (session.last_run_status === 'crashed') return 'failed'
  return 'completed'
}

/**
 * The state of `run`, one entry of `schedule.history`. An ended run has its
 * end recorded. A run with no end yet takes the state of its session: the
 * prompt still in the session's queue is queued; otherwise the newest open
 * run of the session is the one that runs (or ran while the app was closed).
 */
export function scheduleRunState(
  run: ScheduleRun,
  schedule: Schedule,
  session: Session | undefined
): ScheduleRunState {
  if (run.outcome !== 'queued') return run.outcome
  const sameSession = (schedule.history ?? []).filter(
    r => r.outcome === 'queued' && r.session_id === run.session_id
  )
  const newest = sameSession[sameSession.length - 1]
  switch (run.end) {
    case 'completed':
    case 'cancelled':
    case 'failed':
      return run.end
    case 'waiting':
      return run === newest && session?.waiting_for_input
        ? 'waiting'
        : 'completed'
  }
  if (!session) return 'queued'
  // Open runs of this session, newest first. At most the newest one can
  // still wait in the queue: a repeat adds no copy while one waits (#144).
  const open = sameSession.filter(r => !r.end).reverse()
  const inQueue = (session.queued_messages ?? []).some(
    m => m.scheduleId === schedule.id
  )
  if (inQueue && open[0] === run) return 'queued'
  const current = inQueue ? open[1] : open[0]
  return current === run ? liveState(session) : 'completed'
}

/** Dot and label per state, from the session status config. */
export const runStateConfig: Record<
  ScheduleRunState,
  { label: string; indicator: (typeof statusConfig)[keyof typeof statusConfig] }
> = {
  running: { label: 'Running', indicator: statusConfig.vibing },
  queued: { label: 'Queued', indicator: statusConfig.scheduled },
  waiting: { label: 'Waiting for input', indicator: statusConfig.waiting },
  completed: { label: 'Completed', indicator: statusConfig.completed },
  cancelled: { label: 'Cancelled', indicator: statusConfig.cancelled },
  failed: { label: 'Failed', indicator: statusConfig.crashed },
  skipped: { label: 'Skipped', indicator: statusConfig.idle },
  still_queued: {
    label: 'Skipped (the previous run is still queued)',
    indicator: statusConfig.idle,
  },
}

function RunStateDot({ state }: { state: ScheduleRunState }) {
  const { label, indicator } = runStateConfig[state]
  return (
    <StatusIndicator
      status={indicator.indicatorStatus}
      variant={indicator.indicatorVariant}
      shape={indicator.indicatorShape}
      label={label}
      className="size-2"
    />
  )
}

/** Expanded schedules, kept while the app runs (not saved). */
const expandedSchedules = new Set<string>()

/**
 * The runs a schedule started (#38 follow-up): collapsed, a count and the
 * last run's state; expanded, the newest runs with their session and state.
 * A click opens the run's session.
 */
export function ScheduleRuns({
  schedule,
  places,
  now,
  onOpenSession,
}: {
  schedule: Schedule
  places: Map<string, SessionPlace>
  now: number
  onOpenSession: (place: SessionPlace) => void
}) {
  const [expanded, setExpanded] = useState(() =>
    expandedSchedules.has(schedule.id)
  )
  const [showAll, setShowAll] = useState(false)

  const runs = useMemo(
    () =>
      [...(schedule.history ?? [])].reverse().map(run => {
        const place = run.session_id ? places.get(run.session_id) : undefined
        return {
          run,
          place,
          state: scheduleRunState(run, schedule, place?.session),
        }
      }),
    [schedule, places]
  )

  const last = runs[0]
  if (!last) return null

  const toggle = () => {
    const next = !expanded
    if (next) expandedSchedules.add(schedule.id)
    else expandedSchedules.delete(schedule.id)
    setExpanded(next)
  }
  const visible = showAll ? runs : runs.slice(0, VISIBLE_RUNS)

  return (
    <div className="flex flex-col gap-1 text-xs">
      <button
        type="button"
        className="flex w-fit items-center gap-1.5 rounded text-muted-foreground hover:text-foreground"
        aria-expanded={expanded}
        onClick={toggle}
      >
        <ChevronRight
          className={cn(
            'size-3.5 transition-transform',
            expanded && 'rotate-90'
          )}
          aria-hidden="true"
        />
        <span>
          {runs.length} {runs.length === 1 ? 'run' : 'runs'}
        </span>
        {!expanded && (
          <>
            <span aria-hidden="true">·</span>
            <RunStateDot state={last.state} />
            <span>last: {runStateConfig[last.state].label}</span>
          </>
        )}
      </button>
      {expanded && (
        <ul className="flex flex-col" data-testid="schedule-runs">
          {visible.map(({ run, place, state }, index) => {
            const when = `${formatRelativeTime(run.fired_at_unix, now)} (${formatMessageTimestamp(run.fired_at_unix, now)})`
            const content = (
              <>
                <RunStateDot state={state} />
                <span className="min-w-0 truncate">
                  {run.session_id
                    ? (place?.session.name ?? 'Unknown session')
                    : 'No session'}
                  {place && (
                    <span className="text-muted-foreground">
                      {' '}
                      · {place.projectName} › {place.worktreeName}
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    'shrink-0',
                    state === 'failed'
                      ? 'text-destructive'
                      : 'text-muted-foreground'
                  )}
                >
                  {runStateConfig[state].label}
                </span>
                <span className="shrink-0 text-muted-foreground">{when}</span>
              </>
            )
            const rowClass =
              'grid w-full grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-2 rounded px-1.5 py-1 text-left'
            return (
              <li
                key={`${run.fired_at_unix}-${index}`}
                data-testid="schedule-run"
                title={run.error}
              >
                {place ? (
                  <button
                    type="button"
                    className={cn(rowClass, 'hover:bg-accent/50')}
                    onClick={() => onOpenSession(place)}
                  >
                    {content}
                  </button>
                ) : (
                  <div className={rowClass}>{content}</div>
                )}
                {run.error && (
                  <div className="truncate pl-5 text-destructive">
                    {run.error}
                  </div>
                )}
              </li>
            )
          })}
          {runs.length > VISIBLE_RUNS && (
            <li>
              <button
                type="button"
                className="px-1.5 py-1 text-primary underline-offset-2 hover:underline"
                onClick={() => setShowAll(value => !value)}
              >
                {showAll ? 'Show fewer' : `Show all ${runs.length}`}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
