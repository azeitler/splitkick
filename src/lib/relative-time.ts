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
