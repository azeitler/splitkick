import { useCallback, useMemo } from 'react'
import { CalendarClock, Clock, Repeat } from 'lucide-react'
import { useIsMobile } from '@/hooks/use-mobile'
import { useNow } from '@/hooks/useNow'
import { formatTimeUntil } from '@/lib/relative-time'
import { describeRecurrence } from '@/lib/schedule-format'
import { openScheduleView } from '@/lib/scheduled-view'
import { cn } from '@/lib/utils'
import { useAllSessions } from '@/services/chat'
import { useSchedules } from '@/services/schedules'
import { useUIStore } from '@/store/ui-store'
import type { Schedule } from '@/types/chat'
import { scheduleTitle } from '@/components/schedules/ScheduleDetailView'
import {
  RunStateDot,
  runStateConfig,
  scheduleRunRows,
  sessionPlaces,
  type ScheduleRunState,
} from '@/components/schedules/ScheduleRuns'
import { SidebarTabEmpty } from './SidebarTabEmpty'
import {
  SIDEBAR_PROJECT_ROW_PADDING,
  SIDEBAR_ROW_SELECTED,
  SIDEBAR_ROW_SHAPE,
} from './sidebar-row-styles'

/** "in 2h · daily at 09:00", "Paused · once". */
export function scheduleSubtitle(schedule: Schedule, now: number): string {
  const rule = schedule.recurrence
    ? describeRecurrence(schedule.recurrence)
    : 'once'
  const next =
    schedule.enabled === false
      ? 'Paused'
      : formatTimeUntil(schedule.fire_at_unix, now)
  return `${next} · ${rule}`
}

/**
 * The sidebar's Scheduled tab (#38): every schedule in every project, active
 * ones first (soonest first), then paused ones. A row shows the state of its
 * last run; a click opens the schedule's settings and runs in the main area.
 */
export function SidebarScheduledSection() {
  const activeScheduleId = useUIStore(state => state.activeScheduleId)
  const isMobile = useIsMobile()
  const now = useNow()
  const { data: schedules = [] } = useSchedules()
  const { data: sessions } = useAllSessions()
  const places = useMemo(() => sessionPlaces(sessions), [sessions])

  const ordered = useMemo(
    () => [
      ...schedules.filter(s => s.enabled !== false),
      ...schedules.filter(s => s.enabled === false),
    ],
    [schedules]
  )

  const handleOpen = useCallback(
    (scheduleId: string) => {
      openScheduleView(scheduleId)
      if (isMobile) useUIStore.getState().setLeftSidebarVisible(false)
    },
    [isMobile]
  )

  if (ordered.length === 0) {
    return (
      <SidebarTabEmpty
        icon={<CalendarClock />}
        title="Nothing is scheduled"
        hint="In a chat, use the arrow next to Send: Send later… or Repeat…."
        testId="sidebar-scheduled-empty"
      />
    )
  }

  return (
    <div className="py-1" data-testid="sidebar-scheduled-section">
      {ordered.map(schedule => (
        <SidebarScheduleRow
          key={schedule.id}
          schedule={schedule}
          subtitle={scheduleSubtitle(schedule, now)}
          lastState={scheduleRunRows(schedule, places)[0]?.state}
          selected={schedule.id === activeScheduleId}
          onOpen={handleOpen}
        />
      ))}
    </div>
  )
}

function SidebarScheduleRow({
  schedule,
  subtitle,
  lastState,
  selected,
  onOpen,
}: {
  schedule: Schedule
  subtitle: string
  lastState?: ScheduleRunState
  selected: boolean
  onOpen: (scheduleId: string) => void
}) {
  const paused = schedule.enabled === false
  const Icon = schedule.recurrence ? Repeat : Clock
  return (
    <button
      type="button"
      onClick={() => onOpen(schedule.id)}
      aria-current={selected ? 'page' : undefined}
      data-testid={`sidebar-schedule-row-${schedule.id}`}
      className={cn(
        'group relative flex cursor-pointer items-start gap-1.5 py-1.5 text-left transition-colors duration-150',
        SIDEBAR_ROW_SHAPE,
        SIDEBAR_PROJECT_ROW_PADDING,
        selected
          ? SIDEBAR_ROW_SELECTED
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
      )}
    >
      <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            'truncate text-sm',
            paused
              ? 'text-muted-foreground'
              : selected
                ? 'text-foreground'
                : 'text-foreground/90'
          )}
        >
          {scheduleTitle(schedule)}
        </span>
        <span className="truncate text-[11px] text-muted-foreground">
          {subtitle}
        </span>
      </span>
      {lastState && (
        <span
          className="mr-1 mt-1.5 flex shrink-0"
          title={`Last run: ${runStateConfig[lastState].label}`}
          data-testid="sidebar-schedule-last-state"
          data-state={lastState}
        >
          <RunStateDot state={lastState} />
        </span>
      )}
    </button>
  )
}
