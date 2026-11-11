import { useNow } from '@/hooks/useNow'
import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import {
  CalendarClock,
  Clock,
  Pause,
  Pencil,
  Play,
  Repeat,
  Trash2,
  Zap,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
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
import { describeRecurrence } from '@/lib/schedule-format'
import { navigateToSession } from '@/lib/navigate-to-session'
import {
  deleteSchedule,
  runScheduleNow,
  schedulesQueryKeys,
  setScheduleEnabled,
  updateSchedule,
  useSchedules,
} from '@/services/schedules'
import { useAllSessions } from '@/services/chat'
import type { AllSessionsResponse, Schedule } from '@/types/chat'

/** Where a schedule runs, by name. */
export interface ScheduleWhere {
  projectId?: string
  projectName: string
  worktreeName: string
  /** The session the schedule was made in */
  sessionName?: string
  /** Names by session id, for the last run's session */
  sessionNames: Map<string, string>
}

/** Look up project, worktree and session names for a schedule. */
export function resolveWhere(
  schedule: Schedule,
  sessions: AllSessionsResponse | undefined
): ScheduleWhere {
  const entry = sessions?.entries.find(
    e => e.worktree_id === schedule.worktree_id
  )
  const sessionNames = new Map(
    (entry?.sessions ?? []).map(s => [s.id, s.name] as const)
  )
  return {
    projectId: entry?.project_id,
    projectName: entry?.project_name ?? 'Unknown project',
    worktreeName: entry?.worktree_name ?? 'Unknown worktree',
    sessionName: sessionNames.get(schedule.session_id),
    sessionNames,
  }
}

/** "in 2h (Nov 9th 26, 09:00)", or "Paused". */
export function nextRunText(schedule: Schedule, now = Date.now()): string {
  if (schedule.enabled === false) return 'Paused'
  return `${formatTimeUntil(schedule.fire_at_unix, now)} (${formatMessageTimestamp(schedule.fire_at_unix, now)})`
}

/** "3h ago (…) · queued", or null when it never ran. */
export function lastRunText(
  schedule: Schedule,
  now = Date.now()
): string | null {
  if (!schedule.last_run_unix) return null
  const when = `${formatRelativeTime(schedule.last_run_unix, now)} (${formatMessageTimestamp(schedule.last_run_unix, now)})`
  const outcome = schedule.last_outcome ?? 'queued'
  return `${when} · ${outcome}`
}

function isYolo(schedule: Schedule): boolean {
  return schedule.template?.executionMode === 'yolo'
}

/**
 * The Scheduled view (#38), opened from the sidebar's Scheduled row: every
 * schedule in every project, agent and user ones, with pause, resume, edit,
 * run now and delete.
 */
export function ScheduledView() {
  const hasToolbar = useHasWindowToolbar()
  return (
    <>
      {hasToolbar && (
        <ToolbarContent
          title="Scheduled"
          subtitle="Prompts that run later or repeat, in every project."
          search={<ToolbarPaletteSearch />}
        />
      )}
      <ScheduledList showHeading={!hasToolbar} />
    </>
  )
}

export function ScheduledList({
  showHeading = false,
}: {
  showHeading?: boolean
}) {
  const queryClient = useQueryClient()
  const { data: schedules, isLoading } = useSchedules()
  const { data: sessions } = useAllSessions()
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState<Schedule | null>(null)
  // "in 2h" / "5m ago" tick without a refetch (#123).
  const now = useNow()

  // Active ones first (soonest first, as the backend sends them), then paused.
  const ordered = useMemo(() => {
    const list = schedules ?? []
    return [
      ...list.filter(s => s.enabled !== false),
      ...list.filter(s => s.enabled === false),
    ]
  }, [schedules])

  const run = useCallback(
    async (id: string, action: () => Promise<unknown>, failure: string) => {
      setBusy(id)
      try {
        await action()
        await queryClient.invalidateQueries({
          queryKey: schedulesQueryKeys.all,
        })
      } catch (err) {
        toast.error(`${failure}: ${err}`)
      } finally {
        setBusy(null)
      }
    },
    [queryClient]
  )

  const handleEdit = useCallback(
    async (values: ScheduleFormValues) => {
      if (!editing) return
      await updateSchedule({
        scheduleId: editing.id,
        prompt: values.prompt,
        name: values.name,
        target: values.target,
        fireAtUnix: values.fireAtUnix,
        recurrence: values.recurrence,
      })
      await queryClient.invalidateQueries({ queryKey: schedulesQueryKeys.all })
    },
    [editing, queryClient]
  )

  const openSession = useCallback(
    (projectId: string | undefined, worktreeId: string, sessionId: string) => {
      if (!projectId) {
        toast.error('The session is no longer in a project.')
        return
      }
      navigateToSession({ projectId, worktreeId, sessionId })
    },
    []
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-2 p-4 sm:p-6">
        {showHeading && (
          <h1 className="mb-2 text-lg font-semibold">Scheduled</h1>
        )}
        {!isLoading && ordered.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted-foreground">
            <CalendarClock className="size-8" aria-hidden="true" />
            <p>Nothing is scheduled.</p>
            <p>
              In a chat, use the arrow next to Send: Send later… or Repeat….
            </p>
          </div>
        )}
        {ordered.map(schedule => {
          const where = resolveWhere(schedule, sessions)
          const lastRun = lastRunText(schedule, now)
          const lastSessionName = schedule.last_session_id
            ? where.sessionNames.get(schedule.last_session_id)
            : undefined
          const paused = schedule.enabled === false
          const disabled = busy === schedule.id
          return (
            <div
              key={schedule.id}
              data-testid="scheduled-row"
              className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 text-sm sm:flex-row sm:items-start"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  {schedule.recurrence ? (
                    <Repeat className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <Clock className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 truncate font-medium">
                    {schedule.name || schedule.prompt}
                  </span>
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
                {schedule.name && (
                  <div className="truncate text-muted-foreground">
                    {schedule.prompt}
                  </div>
                )}
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                  <dt className="text-muted-foreground">Runs in</dt>
                  <dd className="min-w-0 truncate">
                    {where.projectName} › {where.worktreeName} ›{' '}
                    {schedule.target === 'new_session'
                      ? 'a new session each run'
                      : (where.sessionName ?? 'Unknown session')}
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
                      <dd className="min-w-0">
                        <span
                          className={
                            schedule.last_outcome === 'failed'
                              ? 'text-destructive'
                              : undefined
                          }
                        >
                          {lastRun}
                        </span>
                        {schedule.last_session_id && (
                          <>
                            {' · '}
                            <button
                              type="button"
                              className="text-primary underline-offset-2 hover:underline"
                              onClick={() =>
                                openSession(
                                  where.projectId,
                                  schedule.worktree_id,
                                  schedule.last_session_id as string
                                )
                              }
                            >
                              {lastSessionName ?? 'Open session'}
                            </button>
                          </>
                        )}
                      </dd>
                    </>
                  )}
                  {schedule.last_error && (
                    <>
                      <dt className="text-muted-foreground">Error</dt>
                      <dd className="text-destructive">
                        {schedule.last_error}
                      </dd>
                    </>
                  )}
                </dl>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <RowAction
                  label={paused ? 'Resume' : 'Pause'}
                  disabled={disabled}
                  onClick={() =>
                    run(
                      schedule.id,
                      () => setScheduleEnabled(schedule.id, paused),
                      paused ? 'Failed to resume' : 'Failed to pause'
                    )
                  }
                >
                  {paused ? (
                    <Play className="size-4" />
                  ) : (
                    <Pause className="size-4" />
                  )}
                </RowAction>
                <RowAction
                  label="Edit"
                  disabled={disabled}
                  onClick={() => setEditing(schedule)}
                >
                  <Pencil className="size-4" />
                </RowAction>
                <RowAction
                  label="Run now"
                  disabled={disabled}
                  onClick={() =>
                    run(
                      schedule.id,
                      async () => {
                        await runScheduleNow(schedule.id)
                        toast.success('Prompt sent')
                      },
                      'Failed to run'
                    )
                  }
                >
                  <Zap className="size-4" />
                </RowAction>
                <RowAction
                  label="Delete"
                  disabled={disabled}
                  onClick={() =>
                    run(
                      schedule.id,
                      () => deleteSchedule(schedule.id),
                      'Failed to delete'
                    )
                  }
                >
                  <Trash2 className="size-4" />
                </RowAction>
              </div>
            </div>
          )
        })}
      </div>
      {editing && (
        <ScheduleDialog
          open
          onOpenChange={open => {
            if (!open) setEditing(null)
          }}
          kind={editing.recurrence ? 'repeat' : 'once'}
          initial={{
            prompt: editing.prompt,
            name: editing.name,
            target: editing.target ?? 'session',
            fireAtUnix: editing.fire_at_unix,
            recurrence: editing.recurrence,
          }}
          title="Edit schedule"
          submitLabel="Save"
          onSubmit={handleEdit}
        />
      )}
    </div>
  )
}

function RowAction({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 text-muted-foreground hover:text-foreground"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
