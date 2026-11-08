import type { QueuedMessage, ScheduleTarget } from '@/types/chat'

/** What the composer menu opens: a one-off or a repeating schedule. */
export type ScheduleKind = 'once' | 'repeat'

/** Repeat presets offered in the dialog; `custom` shows the raw cron field. */
export type RepeatPreset = 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'custom'

/**
 * Plan Q1: *Send later* goes into this session (the user is in it); *Repeat*
 * gets a new session per run (clean context, own unread marker).
 */
export function defaultTarget(kind: ScheduleKind): ScheduleTarget {
  return kind === 'once' ? 'session' : 'new_session'
}

export interface QuickPick {
  label: string
  at: Date
}

/** "In 1 hour", "Tomorrow 09:00", "Monday 09:00" from `now`. */
export function quickPicks(now = new Date()): QuickPick[] {
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000)
  inOneHour.setSeconds(0, 0)

  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(9, 0, 0, 0)

  // Next Monday, never today: on a Monday this is a week from now.
  const monday = new Date(now)
  const daysToMonday = (8 - monday.getDay()) % 7 || 7
  monday.setDate(monday.getDate() + daysToMonday)
  monday.setHours(9, 0, 0, 0)

  return [
    { label: 'In 1 hour', at: inOneHour },
    { label: 'Tomorrow 09:00', at: tomorrow },
    { label: 'Monday 09:00', at: monday },
  ]
}

/** `HH:MM` → [hour, minute], or null when it does not parse. */
export function parseTime(time: string): [number, number] | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return [hour, minute]
}

/**
 * The 5-field cron pattern for a preset. `weekday` is 0 (Sunday) – 6. Returns
 * null when the time does not parse (hourly only needs the minute).
 */
export function presetToCron(
  preset: Exclude<RepeatPreset, 'custom'>,
  time: string,
  weekday = 1
): string | null {
  const parsed = parseTime(time)
  if (!parsed) return null
  const [hour, minute] = parsed
  switch (preset) {
    case 'hourly':
      return `${minute} * * * *`
    case 'daily':
      return `${minute} ${hour} * * *`
    case 'weekdays':
      return `${minute} ${hour} * * 1-5`
    case 'weekly':
      return `${minute} ${hour} * * ${weekday}`
  }
}

/** Value for `<input type="datetime-local">` in local time. */
export function toDateTimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Seconds since the epoch for a `datetime-local` value, or null. */
export function fromDateTimeLocal(value: string): number | null {
  if (!value) return null
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000)
}

/**
 * The composer's queued message as a schedule template: the toolbar
 * settings and attachments. `id` and `queuedAt` are set again at every run;
 * the prompt is stored on the schedule itself.
 */
export function toScheduleTemplate(
  queued: QueuedMessage
): Record<string, unknown> {
  const template: Record<string, unknown> = { ...queued }
  delete template.id
  delete template.queuedAt
  delete template.message
  return template
}

/**
 * Plan Q3: a run in Yolo mode writes, commits and runs commands with nobody
 * watching, so the user confirms it once per schedule.
 */
export function needsYoloConfirm(
  template: Pick<QueuedMessage, 'executionMode'> | Record<string, unknown>
): boolean {
  return template.executionMode === 'yolo'
}
