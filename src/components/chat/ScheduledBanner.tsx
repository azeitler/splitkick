import { useCallback, useMemo, useState } from 'react'
import { Clock, X } from 'lucide-react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { formatMessageTimestamp, formatTimeUntil } from '@/lib/relative-time'
import {
  deleteSchedule,
  schedulesQueryKeys,
  useSchedules,
} from '@/services/schedules'

interface ScheduledBannerProps {
  sessionId: string | null
}

/**
 * Pending schedules of the session, soonest first, each with a cancel
 * button: "Scheduled · in 2h (Oct 26th 26, 14:00)" and the prompt.
 */
export function ScheduledBanner({ sessionId }: ScheduledBannerProps) {
  const queryClient = useQueryClient()
  const { data: schedules } = useSchedules()
  const [deleting, setDeleting] = useState<string | null>(null)

  const pending = useMemo(
    () => (schedules ?? []).filter(s => s.session_id === sessionId),
    [schedules, sessionId]
  )

  const handleCancel = useCallback(
    async (scheduleId: string) => {
      setDeleting(scheduleId)
      try {
        await deleteSchedule(scheduleId)
        await queryClient.invalidateQueries({
          queryKey: schedulesQueryKeys.all,
        })
      } catch (err) {
        toast.error(`Failed to cancel schedule: ${err}`)
      } finally {
        setDeleting(null)
      }
    },
    [queryClient]
  )

  if (!sessionId || pending.length === 0) return null

  return (
    <div className="mb-2 flex flex-col gap-1">
      {pending.map(schedule => (
        <div
          key={schedule.id}
          className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm"
        >
          <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium text-muted-foreground">
              Scheduled · {formatTimeUntil(schedule.fire_at_unix)} (
              {formatMessageTimestamp(schedule.fire_at_unix)})
            </div>
            <div className="truncate text-foreground">{schedule.prompt}</div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => handleCancel(schedule.id)}
            disabled={deleting === schedule.id}
            aria-label="Cancel schedule"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
    </div>
  )
}
