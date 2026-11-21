import type { ScheduleOutcome, ScheduleRecurrence } from '@/types/chat'

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

/** Plain text for a schedule's last outcome. */
export function outcomeText(outcome: ScheduleOutcome): string {
  return outcome === 'still_queued'
    ? 'skipped (the previous run is still queued)'
    : outcome
}

/**
 * A hint for a `*\/N` step that does not divide its field's cycle (60
 * minutes, 24 hours): `*\/45` fires at minutes 0 and 45, not every 45
 * minutes (#144). Mirrors `cron_step_hint` in jean-core. Null otherwise.
 */
export function cronStepHint(cron: string): string | null {
  const fields = cron.trim().split(/\s+/)
  const units = [
    { index: 0, unit: 'minute', cycle: 60, per: 'hour' },
    { index: 1, unit: 'hour', cycle: 24, per: 'day' },
  ]
  for (const { index, unit, cycle, per } of units) {
    const match = /^\*\/(\d+)$/.exec(fields[index] ?? '')
    if (!match) continue
    const step = Number(match[1])
    if (step <= 1 || step >= cycle || cycle % step === 0) continue
    const values: number[] = []
    for (let v = 0; v < cycle; v += step) values.push(v)
    const gap = cycle - (values[values.length - 1] ?? 0)
    return `*/${step} runs at ${unit}s ${values.join(', ')} of every ${per} (${step} ${unit}s apart, then ${gap} to the next ${per}), not every ${step} ${unit}s.`
  }
  return null
}
