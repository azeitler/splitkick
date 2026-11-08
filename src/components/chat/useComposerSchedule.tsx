import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { formatMessageTimestamp, formatTimeUntil } from '@/lib/relative-time'
import {
  needsYoloConfirm,
  toScheduleTemplate,
  type ScheduleKind,
} from '@/lib/schedule-compose'
import { createSchedule, schedulesQueryKeys } from '@/services/schedules'
import type { ScheduleDraft } from './hooks/useMessageSending'
import { ScheduleDialog, type ScheduleFormValues } from './ScheduleDialog'

/**
 * *Send later…* / *Repeat…* from the Send menu (#38): capture the composer's
 * prompt and toolbar settings, let the user pick the time and target, save
 * the schedule and empty the composer.
 */
export function useComposerSchedule(
  captureDraft: () => ScheduleDraft | null,
  clearComposer: () => void
) {
  const queryClient = useQueryClient()
  const [kind, setKind] = useState<ScheduleKind | null>(null)
  const [draft, setDraft] = useState<ScheduleDraft | null>(null)

  const onSchedule = useCallback(
    (next: ScheduleKind) => {
      const captured = captureDraft()
      if (!captured) return
      if (!captured.prompt) {
        toast.message('Type the prompt to schedule first.')
        return
      }
      setDraft(captured)
      setKind(next)
    },
    [captureDraft]
  )

  const onSubmit = useCallback(
    async (values: ScheduleFormValues) => {
      if (!draft) return
      const schedule = await createSchedule({
        sessionId: draft.sessionId,
        prompt: values.prompt,
        fireAtUnix: values.fireAtUnix,
        recurrence: values.recurrence,
        name: values.name || undefined,
        target: values.target,
        template: toScheduleTemplate(draft.queued),
      })
      clearComposer()
      await queryClient.invalidateQueries({ queryKey: schedulesQueryKeys.all })
      toast.success(
        `Scheduled · ${formatTimeUntil(schedule.fire_at_unix)} (${formatMessageTimestamp(schedule.fire_at_unix)})`
      )
    },
    [draft, clearComposer, queryClient]
  )

  const dialog =
    kind && draft ? (
      <ScheduleDialog
        open
        onOpenChange={open => {
          if (!open) setKind(null)
        }}
        kind={kind}
        initial={{ prompt: draft.prompt }}
        yolo={needsYoloConfirm(draft.queued)}
        onSubmit={onSubmit}
      />
    ) : null

  return { onSchedule, dialog }
}
