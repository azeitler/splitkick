/**
 * Normalize a timestamp to milliseconds.
 *
 * Jean stores some timestamps in unix seconds and others in milliseconds, so
 * anything below the year-2001-in-milliseconds threshold is treated as seconds.
 */
export function toMilliseconds(timestamp: number): number {
  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp
}

/** Compact "time ago" label — `just now`, `5m ago`, `3h ago`, `2d ago`. */
export function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - toMilliseconds(timestamp)
  if (diffMs < 0) return 'just now'
  const minuteMs = 60_000
  const hourMs = 60 * minuteMs
  const dayMs = 24 * hourMs
  if (diffMs < hourMs)
    return `${Math.max(1, Math.floor(diffMs / minuteMs))}m ago`
  if (diffMs < dayMs) return `${Math.floor(diffMs / hourMs)}h ago`
  return `${Math.floor(diffMs / dayMs)}d ago`
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/**
 * Timestamp shown next to a chat message.
 *
 * Messages from today only need the clock time. Older messages also need the
 * date, because a bare time is ambiguous once a thread spans several days.
 *
 * `now` is injectable so the tests stay deterministic.
 */
export function formatMessageTimestamp(
  timestamp: number,
  now = Date.now()
): string {
  const date = new Date(toMilliseconds(timestamp))
  if (isSameDay(date, new Date(now))) {
    return date.toLocaleTimeString(undefined, { timeStyle: 'short' })
  }
  return date.toLocaleString(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

function agoLabel(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? '' : 's'} ago`
}

/** Days take over from hours at this age, so 36h reads "2 days ago", not "1 day ago". */
export const LAST_ACTIVE_DAYS_THRESHOLD_MS = 36 * 60 * 60 * 1000

/**
 * Long-form staleness label for the chat "Last active" badge — `just now`,
 * `5 minutes ago`, `35 hours ago`, `2 days ago`.
 *
 * `now` is injectable so the tests stay deterministic.
 */
export function formatLastActive(timestamp: number, now = Date.now()): string {
  const diffMs = now - toMilliseconds(timestamp)
  const minuteMs = 60_000
  const hourMs = 60 * minuteMs
  const dayMs = 24 * hourMs

  if (diffMs < minuteMs) return 'just now'
  if (diffMs < hourMs) return agoLabel(Math.round(diffMs / minuteMs), 'minute')
  if (diffMs < LAST_ACTIVE_DAYS_THRESHOLD_MS)
    return agoLabel(Math.max(1, Math.round(diffMs / hourMs)), 'hour')
  return agoLabel(Math.round(diffMs / dayMs), 'day')
}
