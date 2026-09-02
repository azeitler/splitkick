import { Fragment, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { formatMessageTimestamp } from '@/lib/relative-time'
import { useUIStore } from '@/store/ui-store'
import { formatDuration } from './time-utils'

interface MessageMetaLineProps {
  /** Message time in unix seconds. Suppressed in zen mode. */
  timestamp?: number | null
  /** Turn runtime in ms. Rendered whenever positive, independent of the timestamp. */
  durationMs?: number | null
  /** Extra meta segments, e.g. the compact view's "(cancelled)" marker. */
  children?: ReactNode
  className?: string
}

/**
 * The muted line under a message holding its timestamp and turn runtime,
 * separated by dots.
 *
 * Timestamp and runtime deliberately share one type scale, and stay in
 * separate spans with independent conditions: the runtime renders on its own
 * terms, so adding timestamps can never hide or replace it. Zen mode drops the
 * timestamp only.
 */
export function MessageMetaLine({
  timestamp,
  durationMs,
  children,
  className,
}: MessageMetaLineProps) {
  const zenMode = useUIStore(state => state.zenMode)

  const showDuration = durationMs != null && durationMs > 0
  const showTimestamp = !zenMode && timestamp != null && timestamp > 0

  if (!showTimestamp && !showDuration && !children) return null

  const segments: ReactNode[] = []
  if (showTimestamp) {
    segments.push(
      <span key="timestamp" className="tabular-nums">
        {formatMessageTimestamp(timestamp)}
      </span>
    )
  }
  if (showDuration) {
    segments.push(
      <span key="duration" className="tabular-nums">
        {formatDuration(durationMs)}
      </span>
    )
  }
  if (children) segments.push(<Fragment key="extra">{children}</Fragment>)

  return (
    <div
      className={cn(
        'mt-1 flex min-h-4 flex-wrap items-center gap-x-1.5 text-xs leading-4 text-muted-foreground/40',
        className
      )}
    >
      {segments.map((segment, index) => (
        <Fragment key={index}>
          {index > 0 && (
            <span aria-hidden className="text-muted-foreground/30">
              ·
            </span>
          )}
          {segment}
        </Fragment>
      ))}
    </div>
  )
}
