import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { formatMessageTimestamp, formatTimeUntil } from '@/lib/relative-time'
import { describeRecurrence } from '@/lib/schedule-format'
import {
  defaultTarget,
  fromDateTimeLocal,
  presetToCron,
  quickPicks,
  toDateTimeLocal,
  type RepeatPreset,
  type ScheduleKind,
} from '@/lib/schedule-compose'
import type { ScheduleRecurrence, ScheduleTarget } from '@/types/chat'

/** What the dialog hands back on submit. */
export interface ScheduleFormValues {
  prompt: string
  name: string
  target: ScheduleTarget
  /** Set for a one-off (seconds) */
  fireAtUnix?: number
  /** Set for a repeating schedule */
  recurrence?: ScheduleRecurrence
}

/** Start values: a draft from the composer, or a schedule being edited. */
export interface ScheduleFormInitial {
  prompt: string
  name?: string
  target?: ScheduleTarget
  fireAtUnix?: number
  recurrence?: ScheduleRecurrence
}

interface ScheduleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  kind: ScheduleKind
  initial: ScheduleFormInitial
  /** The run uses Yolo mode: confirm before saving (plan Q3) */
  yolo?: boolean
  /** "Schedule" for a new one, "Save" when editing */
  submitLabel?: string
  /** Defaults to "Send later" / "Repeat" */
  title?: string
  onSubmit: (values: ScheduleFormValues) => Promise<void>
}

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

const PRESETS: { value: RepeatPreset; label: string }[] = [
  { value: 'hourly', label: 'Every hour' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Every weekday' },
  { value: 'weekly', label: 'Every week' },
  { value: 'custom', label: 'Custom (cron)' },
]

/** Read a stored rule back into the preset fields. */
export function presetFromRecurrence(recurrence?: ScheduleRecurrence): {
  preset: RepeatPreset
  time: string
  weekday: number
  cron: string
} {
  const cron = recurrence?.cron ?? '0 9 * * *'
  const [m, h, dom, mon, dow, ...rest] = cron.trim().split(/\s+/)
  const isNum = (v?: string) => v !== undefined && /^\d+$/.test(v)
  const pad = (v?: string) => (v ?? '0').padStart(2, '0')
  const custom = { preset: 'custom' as const, time: '09:00', weekday: 1, cron }
  if (rest.length > 0 || dom !== '*' || mon !== '*' || !isNum(m)) return custom
  if (h === '*' && dow === '*')
    return { preset: 'hourly', time: `09:${pad(m)}`, weekday: 1, cron }
  if (!isNum(h)) return custom
  const time = `${pad(h)}:${pad(m)}`
  if (dow === '*') return { preset: 'daily', time, weekday: 1, cron }
  if (dow === '1-5') return { preset: 'weekdays', time, weekday: 1, cron }
  if (isNum(dow) && Number(dow) <= 6)
    return { preset: 'weekly', time, weekday: Number(dow), cron }
  return custom
}

/**
 * Pick when a prompt runs: once at a date and time (*Send later*), or
 * repeating by a preset or a cron pattern (*Repeat*), and into which
 * session. Used by the composer menu and by Edit in the Scheduled view.
 */
export function ScheduleDialog({
  open,
  onOpenChange,
  kind,
  initial,
  yolo = false,
  submitLabel = 'Schedule',
  title,
  onSubmit,
}: ScheduleDialogProps) {
  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const [prompt, setPrompt] = useState(initial.prompt)
  const [name, setName] = useState(initial.name ?? '')
  const [target, setTarget] = useState<ScheduleTarget>(
    initial.target ?? defaultTarget(kind)
  )
  const [at, setAt] = useState(() =>
    toDateTimeLocal(
      initial.fireAtUnix
        ? new Date(initial.fireAtUnix * 1000)
        : (quickPicks()[0]?.at ?? new Date())
    )
  )
  const start = presetFromRecurrence(initial.recurrence)
  const [preset, setPreset] = useState<RepeatPreset>(start.preset)
  const [time, setTime] = useState(start.time)
  const [weekday, setWeekday] = useState(start.weekday)
  const [customCron, setCustomCron] = useState(start.cron)
  const [confirmYolo, setConfirmYolo] = useState(false)
  const [saving, setSaving] = useState(false)

  // Fresh values every time the dialog opens.
  useEffect(() => {
    if (!open) return
    setPrompt(initial.prompt)
    setName(initial.name ?? '')
    setTarget(initial.target ?? defaultTarget(kind))
    setAt(
      toDateTimeLocal(
        initial.fireAtUnix
          ? new Date(initial.fireAtUnix * 1000)
          : (quickPicks()[0]?.at ?? new Date())
      )
    )
    const next = presetFromRecurrence(initial.recurrence)
    setPreset(next.preset)
    setTime(next.time)
    setWeekday(next.weekday)
    setCustomCron(next.cron)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const recurrence = useMemo<ScheduleRecurrence | null>(() => {
    if (kind !== 'repeat') return null
    const cron =
      preset === 'custom'
        ? customCron.trim()
        : presetToCron(preset, time, weekday)
    if (!cron) return null
    return { cron, tz: initial.recurrence?.tz ?? localTz }
  }, [kind, preset, customCron, time, weekday, initial.recurrence, localTz])

  const fireAtUnix = kind === 'once' ? fromDateTimeLocal(at) : null
  const nowUnix = Math.floor(Date.now() / 1000)
  const timeError =
    kind === 'once'
      ? fireAtUnix === null
        ? 'Pick a date and time.'
        : fireAtUnix <= nowUnix
          ? 'Pick a time in the future.'
          : null
      : recurrence === null
        ? 'Enter a valid time or cron pattern.'
        : null
  const canSubmit = prompt.trim().length > 0 && !timeError && !saving

  const save = async () => {
    setSaving(true)
    try {
      await onSubmit({
        prompt: prompt.trim(),
        name: name.trim(),
        target,
        fireAtUnix: kind === 'once' ? (fireAtUnix ?? undefined) : undefined,
        recurrence: recurrence ?? undefined,
      })
      onOpenChange(false)
    } catch (err) {
      toast.error(`Failed to schedule: ${err}`)
    } finally {
      setSaving(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    if (yolo) {
      setConfirmYolo(true)
      return
    }
    void save()
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>
                {title ?? (kind === 'once' ? 'Send later' : 'Repeat')}
              </DialogTitle>
              <DialogDescription>
                {kind === 'once'
                  ? 'The prompt runs once at the time you pick, also when no window is open.'
                  : 'The prompt runs at every match of the rule, also when no window is open.'}
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="schedule-prompt">Prompt</Label>
              <Textarea
                id="schedule-prompt"
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                rows={3}
              />
            </div>

            {kind === 'once' ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="schedule-at">When</Label>
                <Input
                  id="schedule-at"
                  type="datetime-local"
                  value={at}
                  onChange={e => setAt(e.target.value)}
                />
                <div className="flex flex-wrap gap-1.5">
                  {quickPicks().map(pick => (
                    <Button
                      key={pick.label}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setAt(toDateTimeLocal(pick.at))}
                    >
                      {pick.label}
                    </Button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="schedule-preset">Repeat</Label>
                <div className="flex flex-wrap gap-2">
                  <NativeSelect
                    id="schedule-preset"
                    value={preset}
                    onChange={e => setPreset(e.target.value as RepeatPreset)}
                  >
                    {PRESETS.map(p => (
                      <NativeSelectOption key={p.value} value={p.value}>
                        {p.label}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  {preset === 'weekly' && (
                    <NativeSelect
                      aria-label="Day of the week"
                      value={weekday}
                      onChange={e => setWeekday(Number(e.target.value))}
                    >
                      {WEEKDAYS.map((day, index) => (
                        <NativeSelectOption key={day} value={index}>
                          {day}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  )}
                  {preset !== 'custom' && (
                    <Input
                      aria-label="Time"
                      type="time"
                      className="w-28"
                      value={time}
                      onChange={e => setTime(e.target.value)}
                    />
                  )}
                </div>
                {preset === 'custom' && (
                  <Input
                    aria-label="Cron pattern"
                    placeholder="minute hour day month weekday"
                    value={customCron}
                    onChange={e => setCustomCron(e.target.value)}
                    className="font-mono"
                  />
                )}
                {recurrence && (
                  <p className="text-xs text-muted-foreground">
                    Runs {describeRecurrence(recurrence, localTz)}
                    {preset === 'hourly' ? ' (the hour is not used)' : ''}
                  </p>
                )}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="schedule-target">Run in</Label>
              <NativeSelect
                id="schedule-target"
                value={target}
                onChange={e => setTarget(e.target.value as ScheduleTarget)}
              >
                <NativeSelectOption value="session">
                  This session
                </NativeSelectOption>
                <NativeSelectOption value="new_session">
                  A new session in this worktree each run
                </NativeSelectOption>
              </NativeSelect>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="schedule-name">Name (optional)</Label>
              <Input
                id="schedule-name"
                value={name}
                placeholder="Shown in the Scheduled view"
                onChange={e => setName(e.target.value)}
              />
            </div>

            {timeError ? (
              <p className="text-xs text-destructive">{timeError}</p>
            ) : kind === 'once' && fireAtUnix ? (
              <p className="text-xs text-muted-foreground">
                Runs {formatTimeUntil(fireAtUnix)} (
                {formatMessageTimestamp(fireAtUnix)})
              </p>
            ) : null}
            {yolo && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                This prompt runs in Yolo mode: no approvals.
              </p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {submitLabel}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmYolo} onOpenChange={setConfirmYolo}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run unattended in Yolo mode?</AlertDialogTitle>
            <AlertDialogDescription>
              The scheduled run can edit files, commit and run commands with
              nobody watching and without asking for approval. Switch the
              composer to Plan or Build first if you want to keep approvals.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmYolo(false)
                void save()
              }}
            >
              Schedule in Yolo mode
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
