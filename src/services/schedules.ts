import { useQuery } from '@tanstack/react-query'
import { invoke } from '@/lib/transport'
import { hasBackend } from '@/lib/environment'
import type { Schedule } from '@/types/chat'

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
