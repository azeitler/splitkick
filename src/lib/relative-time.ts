/**
 * Normalize a timestamp to milliseconds.
 *
 * Jean stores some timestamps in unix seconds and others in milliseconds, so
 * anything below the year-2001-in-milliseconds threshold is treated as seconds.
 */
export function toMilliseconds(timestamp: number): number {
  return timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp
}

/**
 * Compact "time ago" label — `just now`, `5m ago`, `3h ago`, `2d ago`,
 * `6w ago`, `3mo ago`, `2y ago`.
 *
 * Months use `mo`, not `m`, because `m` already means minutes. Weeks run to
 * `8w` and months start at `2mo`, so the label never appears to jump backwards
 * (`8w` → `2mo` rather than `8w` → `1mo`). Months are a flat 30 days and years
 * a flat 365, which keeps the boundaries predictable at this precision.
 *
 * `now` is injectable so the tests stay deterministic.
 */
export function formatRelativeTime(
  timestamp: number,
  now = Date.now()
): string {
  const diffMs = now - toMilliseconds(timestamp)
  if (diffMs < 0) return 'just now'
  const minuteMs = 60_000
  const hourMs = 60 * minuteMs
  const dayMs = 24 * hourMs
  const weekMs = 7 * dayMs
  const monthMs = 30 * dayMs
  const yearMs = 365 * dayMs
  if (diffMs < hourMs)
    return `${Math.max(1, Math.floor(diffMs / minuteMs))}m ago`
  if (diffMs < dayMs) return `${Math.floor(diffMs / hourMs)}h ago`
  if (diffMs < weekMs) return `${Math.floor(diffMs / dayMs)}d ago`
  if (diffMs < 2 * monthMs) return `${Math.floor(diffMs / weekMs)}w ago`
  if (diffMs < yearMs) return `${Math.floor(diffMs / monthMs)}mo ago`
  return `${Math.floor(diffMs / yearMs)}y ago`
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function ordinalSuffix(day: number): string {
  if (day % 100 >= 11 && day % 100 <= 13) return 'th'
  if (day % 10 === 1) return 'st'
  if (day % 10 === 2) return 'nd'
  if (day % 10 === 3) return 'rd'
  return 'th'
}

/** 24-hour clock time, e.g. "13:23". */
function clockTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

/**
 * Timestamp shown next to a chat message.
 *
 * Messages from today only need the clock time ("13:23"). Older messages also
 * need the date ("Sep 1st 26, 13:23"), because a bare time is ambiguous once a
 * thread spans several days.
 *
 * `now` is injectable so the tests stay deterministic.
 */
export function formatMessageTimestamp(
  timestamp: number,
  now = Date.now()
): string {
  const date = new Date(toMilliseconds(timestamp))
  if (isSameDay(date, new Date(now))) return clockTime(date)

  const month = date.toLocaleDateString(undefined, { month: 'short' })
  const day = date.getDate()
  const year = String(date.getFullYear() % 100).padStart(2, '0')
  return `${month} ${day}${ordinalSuffix(day)} ${year}, ${clockTime(date)}`
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
