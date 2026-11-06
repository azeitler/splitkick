import { Network } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useIsSessionLinked } from '@/services/chat'
import { useUIStore } from '@/store/ui-store'

/** Open the left panel's Network tab (#77, #98) on a session's network. */
export function openSessionNetwork(sessionId: string) {
  const { setSessionNetworkSessionId, openContextPanel } = useUIStore.getState()
  setSessionNetworkSessionId(sessionId)
  openContextPanel('network')
}

/**
 * Small glyph on session rows that have a parent or a child session (#77).
 * Not clickable, because rows are often buttons themselves; the row's context
 * menu has "Show Session Network". Renders nothing for unlinked sessions.
 */
export function SessionNetworkGlyph({
  sessionId,
  startedBySessionId,
  className,
}: {
  sessionId: string
  startedBySessionId?: string | null
  className?: string
}) {
  const linked = useIsSessionLinked(sessionId, startedBySessionId)
  if (!linked) return null
  return (
    <span
      role="img"
      aria-label="Part of a session network"
      title="Part of a session network. Right-click: Show Session Network"
      className={cn('inline-flex shrink-0 text-muted-foreground', className)}
    >
      <Network className="h-3 w-3" />
    </span>
  )
}
