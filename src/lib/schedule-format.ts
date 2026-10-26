import type { ScheduleRecurrence } from '@/types/chat'

const DAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

function pad(value: string): string {
  return value.padStart(2, '0')
}

function isNumber(value: string | undefined): value is string {
  return value !== undefined && /^\d+$/.test(value)
}

/**
 * Plain text for a repeat rule: "every hour at :15", "daily at 09:00",
 * "weekdays at 08:30", "every Monday at 09:00". Other cron patterns show as
 * the pattern. The time zone is added when it is not the local one.
 */
export function describeRecurrence(
  recurrence: ScheduleRecurrence,
  localTz = Intl.DateTimeFormat().resolvedOptions().timeZone
): string {
  const [minute, hour, dayOfMonth, month, dayOfWeek, ...rest] = recurrence.cron
    .trim()
    .split(/\s+/)
  let text = `cron "${recurrence.cron}"`
  if (rest.length === 0 && dayOfMonth === '*' && month === '*') {
    const time = `${pad(hour ?? '')}:${pad(minute ?? '')}`
    if (isNumber(minute) && hour === '*' && dayOfWeek === '*') {
      text = `every hour at :${pad(minute)}`
    } else if (isNumber(minute) && isNumber(hour)) {
      if (dayOfWeek === '*') text = `daily at ${time}`
      else if (dayOfWeek === '1-5') text = `weekdays at ${time}`
      else if (isNumber(dayOfWeek) && DAYS[Number(dayOfWeek) % 7])
        text = `every ${DAYS[Number(dayOfWeek) % 7]} at ${time}`
    }
  }
  return recurrence.tz === localTz ? text : `${text} (${recurrence.tz})`
}
