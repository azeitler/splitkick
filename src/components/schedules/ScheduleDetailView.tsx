import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import {
  CalendarClock,
  ChevronLeft,
  Clock,
  Pause,
  Pencil,
  Play,
  Repeat,
  Trash2,
  Zap,
} from 'lucide-react'
import { useNow } from '@/hooks/useNow'
import { useIsMobile } from '@/hooks/use-mobile'
import {
  confirmDeleteSchedule,
  scheduleDisplayName,
} from '@/lib/destructive-confirms'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  ToolbarContent,
  useHasWindowToolbar,
} from '@/components/toolbar/toolbar-slots'
import { ToolbarPaletteSearch } from '@/components/toolbar/ToolbarSearchField'
import {
  ScheduleDialog,
  type ScheduleFormValues,
} from '@/components/chat/ScheduleDialog'
import {
  formatMessageTimestamp,
  formatRelativeTime,
  formatTimeUntil,
} from '@/lib/relative-time'
import { describeRecurrence, outcomeText } from '@/lib/schedule-format'
import { navigateToSession } from '@/lib/navigate-to-session'
import {
  deleteSchedule,
  runScheduleNow,
  schedulesQueryKeys,
  setScheduleEnabled,
  updateSchedule,
  useSchedules,
} from '@/services/schedules'
import { useAgents } from '@/services/agents'
import { useAllSessions } from '@/services/chat'
import { useUIStore } from '@/store/ui-store'
import type { AllSessionsResponse, Schedule } from '@/types/chat'
import {
  ScheduleRunList,
  runStateConfig,
  scheduleRunRows,
  sessionPlaces,
  type SessionPlace,
} from './ScheduleRuns'

/** Where a schedule runs, by name. */
export interface ScheduleWhere {
  projectId?: string
  projectName: string
  worktreeName: string
  /** The session the schedule was made in */
  sessionName?: string
}

/** Look up project, worktree and session names for a schedule. */
export function resolveWhere(
  schedule: Schedule,
  sessions: AllSessionsResponse | undefined
): ScheduleWhere {
  const entry = sessions?.entries.find(
    e => e.worktree_id === schedule.worktree_id
  )
  return {
    projectId: entry?.project_id,
    projectName: entry?.project_name ?? 'Unknown project',
    worktreeName: entry?.worktree_name ?? 'Unknown worktree',
    sessionName: entry?.sessions.find(s => s.id === schedule.session_id)?.name,
  }
}

/** "in 2h (Nov 9th 26, 09:00)", or "Paused". */
export function nextRunText(schedule: Schedule, now = Date.now()): string {
  if (schedule.enabled === false) return 'Paused'
  return `${formatTimeUntil(schedule.fire_at_unix, now)} (${formatMessageTimestamp(schedule.fire_at_unix, now)})`
}

/**
 * "3h ago (…) · Running", or null when it never ran. With a run history the
 * state is the newest run's (the one the run list shows first); schedules
 * from before the history show the stored outcome.
 */
export function lastRunText(
  schedule: Schedule,
  now = Date.now(),
  places = new Map<string, SessionPlace>()
): string | null {
  if (!schedule.last_run_unix) return null
  const when = `${formatRelativeTime(schedule.last_run_unix, now)} (${formatMessageTimestamp(schedule.last_run_unix, now)})`
  const newest = scheduleRunRows(schedule, places)[0]
  const state = newest
    ? runStateConfig[newest.state].label
    : outcomeText(schedule.last_outcome ?? 'queued')
  return `${when} · ${state}`
}

/** "claude · opus · build": the run settings the schedule captured, or
 *  null when it uses the session's settings at fire time. */
export function settingsText(schedule: Schedule): string | null {
  const template = schedule.template ?? {}
  const parts = ['backend', 'model', 'executionMode', 'effortLevel']
    .map(key => template[key])
    .filter((value): value is string => typeof value === 'string' && !!value)
  return parts.length > 0 ? parts.join(' · ') : null
}

function isYolo(schedule: Schedule): boolean {
  return schedule.template?.executionMode === 'yolo'
}

/** The "Runs in" text of a schedule that targets a named agent. */
function agentRunsIn(agentName: string | undefined): string {
  return agentName
    ? `Agent ${agentName}, in its current session`
    : 'An agent that was removed'
}

/** The schedule's name, or its prompt when it has none. */
export function scheduleTitle(schedule: Schedule): string {
  return schedule.name || schedule.prompt
}

/**
 * One schedule in the main area (#38), opened from the sidebar's Scheduled
 * tab: its settings and actions at the top, then the runs it started, each
 * with its session and state.
 */
export function ScheduleDetailView({ scheduleId }: { scheduleId: string }) {
  const hasToolbar = useHasWindowToolbar()
  const isMobile = useIsMobile()
  const queryClient = useQueryClient()
  const { data: schedules, isLoading } = useSchedules()
  const { data: sessions } = useAllSessions()
  const { data: agents } = useAgents()
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  // "in 2h" / "5m ago" tick without a refetch (#123).
  const now = useNow()
  const places = useMemo(() => sessionPlaces(sessions), [sessions])
  const schedule = schedules?.find(s => s.id === scheduleId)

  const run = useCallback(
    async (action: () => Promise<unknown>, failure: string) => {
      setBusy(true)
      try {
        await action()
        await queryClient.invalidateQueries({
          queryKey: schedulesQueryKeys.all,
        })
      } catch (err) {
        toast.error(`${failure}: ${err}`)
      } finally {
        setBusy(false)
      }
    },
    [queryClient]
  )

  const handleEdit = useCallback(
    async (values: ScheduleFormValues) => {
      await updateSchedule({
        scheduleId,
        prompt: values.prompt,
        name: values.name,
        target: values.target,
        fireAtUnix: values.fireAtUnix,
        recurrence: values.recurrence,
      })
      await queryClient.invalidateQueries({ queryKey: schedulesQueryKeys.all })
    },
    [scheduleId, queryClient]
  )

  const openSession = useCallback(
    (place: SessionPlace) =>
      navigateToSession({
        projectId: place.projectId,
        worktreeId: place.worktreeId,
        sessionId: place.session.id,
      }),
    []
  )

  const toolbar = hasToolbar ? (
    <ToolbarContent
      title="Scheduled"
      subtitle={schedule ? scheduleTitle(schedule) : undefined}
      search={<ToolbarPaletteSearch />}
    />
  ) : null
  const back = isMobile ? (
    <div className="flex shrink-0 px-3 pt-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => useUIStore.getState().setActiveScheduleId(null)}
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        Back
      </Button>
    </div>
  ) : null

  if (!schedule) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground"
        data-testid="schedule-detail"
      >
        {toolbar}
        {back}
        <CalendarClock className="size-8" aria-hidden="true" />
        <p data-testid="schedule-detail-missing">
          {isLoading
            ? 'Loading schedule…'
            : 'This schedule no longer exists: it ran once and is done, or it was deleted.'}
        </p>
      </div>
    )
  }

  const where = resolveWhere(schedule, sessions)
  const lastRun = lastRunText(schedule, now, places)
  const settings = settingsText(schedule)
  const paused = schedule.enabled === false

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-y-auto"
      data-testid="schedule-detail"
    >
      {toolbar}
      {back}
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 sm:p-6">
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                {schedule.recurrence ? (
                  <Repeat className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                  <Clock className="size-4 shrink-0 text-muted-foreground" />
                )}
                <h1 className="min-w-0 truncate text-lg font-semibold">
                  {scheduleTitle(schedule)}
                </h1>
                <Badge variant="muted">
                  {schedule.origin === 'agent' ? 'Agent' : 'User'}
                </Badge>
                {paused && <Badge variant="outline">Paused</Badge>}
                {isYolo(schedule) && (
                  <Badge variant="outline" className="gap-1">
                    <Zap className="size-3" aria-hidden="true" />
                    Yolo
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() =>
                  run(
                    () => setScheduleEnabled(schedule.id, paused),
                    paused ? 'Failed to resume' : 'Failed to pause'
                  )
                }
              >
                {paused ? <Play /> : <Pause />}
                {paused ? 'Resume' : 'Pause'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => setEditing(true)}
              >
                <Pencil />
                Edit
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await runScheduleNow(schedule.id)
                    toast.success('Prompt sent')
                  }, 'Failed to run')
                }
              >
                <Zap />
                Run now
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                aria-label="Delete"
                onClick={async () => {
                  if (
                    !(await confirmDeleteSchedule(
                      scheduleDisplayName(schedule)
                    ))
                  )
                    return
                  await run(async () => {
                    await deleteSchedule(schedule.id)
                    useUIStore.getState().setActiveScheduleId(null)
                  }, 'Failed to delete')
                }}
              >
                <Trash2 />
              </Button>
            </div>
          </div>
          <p
            className="whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 text-sm"
            data-testid="schedule-detail-prompt"
          >
            {schedule.prompt}
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Runs in</dt>
            <dd className="min-w-0">
              {schedule.target === 'agent' ? (
                // It follows the agent; the session it was made in is not
                // where the next run goes.
                agentRunsIn(agents?.find(a => a.id === schedule.agent_id)?.name)
              ) : (
                <>
                  {where.projectName} › {where.worktreeName} ›{' '}
                  {schedule.target === 'new_session' ? (
                    'a new session each run'
                  ) : where.projectId && where.sessionName ? (
                    <button
                      type="button"
                      className="text-primary underline-offset-2 hover:underline"
                      onClick={() =>
                        navigateToSession({
                          projectId: where.projectId as string,
                          worktreeId: schedule.worktree_id,
                          sessionId: schedule.session_id,
                        })
                      }
                    >
                      {where.sessionName}
                    </button>
                  ) : (
                    'Unknown session'
                  )}
                </>
              )}
            </dd>
            <dt className="text-muted-foreground">Rule</dt>
            <dd>
              {schedule.recurrence
                ? describeRecurrence(schedule.recurrence)
                : 'Once'}
            </dd>
            <dt className="text-muted-foreground">Next</dt>
            <dd>{nextRunText(schedule, now)}</dd>
            {lastRun && (
              <>
                <dt className="text-muted-foreground">Last</dt>
                <dd
                  className={
                    schedule.last_outcome === 'failed'
                      ? 'text-destructive'
                      : undefined
                  }
                >
                  {lastRun}
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">Settings</dt>
            <dd>{settings ?? "The session's settings when it runs"}</dd>
            <dt className="text-muted-foreground">Created</dt>
            <dd>
              {formatRelativeTime(schedule.created_at_unix, now)} (
              {formatMessageTimestamp(schedule.created_at_unix, now)})
            </dd>
            {schedule.last_error && (
              <>
                <dt className="text-muted-foreground">Error</dt>
                <dd className="text-destructive">{schedule.last_error}</dd>
              </>
            )}
          </dl>
        </section>
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">
            Runs
            {(schedule.history?.length ?? 0) > 0 && (
              <span className="ml-1.5 font-normal text-muted-foreground">
                {schedule.history?.length}
              </span>
            )}
          </h2>
          <ScheduleRunList
            key={schedule.id}
            schedule={schedule}
            places={places}
            now={now}
            onOpenSession={openSession}
          />
        </section>
      </div>
      {editing && (
        <ScheduleDialog
          open
          onOpenChange={open => {
            if (!open) setEditing(false)
          }}
          kind={schedule.recurrence ? 'repeat' : 'once'}
          initial={{
            prompt: schedule.prompt,
            name: schedule.name,
            target: schedule.target ?? 'session',
            fireAtUnix: schedule.fire_at_unix,
            recurrence: schedule.recurrence,
          }}
          title="Edit schedule"
          submitLabel="Save"
          onSubmit={handleEdit}
        />
      )}
    </div>
  )
}
