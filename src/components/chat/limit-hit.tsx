import { Zap } from 'lucide-react'
import type { LimitHit } from '@/types/chat'
import {
  formatMessageTimestamp,
  formatRelativeTime,
  toMilliseconds,
} from '@/lib/relative-time'

/** Compact "in" label for a future time — `in 5m`, `in 3h`, `in 2d`. */
function formatTimeUntil(timestamp: number, now: number): string {
  const diffMs = toMilliseconds(timestamp) - now
  const minuteMs = 60_000
  const hourMs = 60 * minuteMs
  if (diffMs < hourMs) return `in ${Math.max(1, Math.ceil(diffMs / minuteMs))}m`
  if (diffMs < 24 * hourMs) return `in ${Math.round(diffMs / hourMs)}h`
  return `in ${Math.round(diffMs / (24 * hourMs))}d`
}

/**
 * "Session limit hit · resets in 2h (20:30)" — or "reset 1h ago (…)" once the
 * reset time has passed. `now` is injectable so the tests stay deterministic.
 */
export function formatLimitHit(limit: LimitHit, now = Date.now()): string {
  const resetsAt = limit.resets_at
  if (!resetsAt) return 'Session limit hit'
  const full = formatMessageTimestamp(resetsAt, now)
  return toMilliseconds(resetsAt) > now
    ? `Session limit hit · resets ${formatTimeUntil(resetsAt, now)} (${full})`
    : `Session limit hit · reset ${formatRelativeTime(resetsAt, now)} (${full})`
}

/** The small lightning that marks a session stopped at the Claude usage limit. */
export function LimitGlyph({ limit }: { limit: LimitHit }) {
  const label = formatLimitHit(limit)
  return (
    <Zap
      data-testid="limit-glyph"
      aria-label={label}
      className="size-3 shrink-0 fill-amber-500 text-amber-500"
    >
      <title>{label}</title>
    </Zap>
  )
}
