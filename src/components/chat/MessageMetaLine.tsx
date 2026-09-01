import type { ReactNode } from 'react'
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
 * The muted line under a message holding its timestamp and turn runtime.
 *
 * The two values are deliberately independent: the runtime renders on its own
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

  return (
    <div
      className={cn(
        'mt-1 flex min-h-4 items-center gap-2 text-xs leading-4 text-muted-foreground/40',
        className
      )}
    >
      {showTimestamp && (
        <span className="tabular-nums">
          {formatMessageTimestamp(timestamp)}
        </span>
      )}
      {showDuration && (
        <span className="tabular-nums font-mono">
          {formatDuration(durationMs)}
        </span>
      )}
      {children}
    </div>
  )
}
