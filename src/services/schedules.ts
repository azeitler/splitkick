import { useQuery } from '@tanstack/react-query'
import { invoke } from '@/lib/transport'
import { hasBackend } from '@/lib/environment'
import type {
  Schedule,
  ScheduleRecurrence,
  ScheduleTarget,
} from '@/types/chat'

export const schedulesQueryKeys = {
  all: ['schedules'] as const,
}

/**
 * Every pending schedule, soonest first. Refetched on the backend's
 * `schedules` cache invalidation (add, delete, fire).
 */
export function useSchedules() {
  return useQuery({
    queryKey: schedulesQueryKeys.all,
    queryFn: () => invoke<Schedule[]>('list_schedules'),
    enabled: hasBackend(),
  })
}

export function deleteSchedule(scheduleId: string): Promise<boolean> {
  return invoke<boolean>('delete_schedule', { scheduleId })
}

export interface CreateScheduleArgs {
  sessionId: string
  prompt: string
  /** One-off time in seconds; ignored when `recurrence` is set */
  fireAtUnix?: number
  recurrence?: ScheduleRecurrence
  name?: string
  target?: ScheduleTarget
  template?: Record<string, unknown>
}

export function createSchedule(args: CreateScheduleArgs): Promise<Schedule> {
  return invoke<Schedule>('create_schedule', { ...args })
}

export interface UpdateScheduleArgs {
  scheduleId: string
  prompt: string
  name?: string
  target?: ScheduleTarget
  fireAtUnix?: number
  recurrence?: ScheduleRecurrence
}

export function updateSchedule(args: UpdateScheduleArgs): Promise<Schedule> {
  return invoke<Schedule>('update_schedule', { ...args })
}

export function setScheduleEnabled(
  scheduleId: string,
  enabled: boolean
): Promise<Schedule> {
  return invoke<Schedule>('set_schedule_enabled', { scheduleId, enabled })
}

/** Run now; resolves to the session the prompt went into. */
export function runScheduleNow(scheduleId: string): Promise<string> {
  return invoke<string>('run_schedule_now', { scheduleId })
}
