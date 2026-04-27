import { useEffect } from 'react'
import { tickStore } from '@/contexts/TickStore'

/**
 * Subscribes to the shared 1Hz tick and calls `onTick(now)` on each tick.
 * Does NOT cause a React re-render — use ref mutations inside `onTick` instead.
 * The interval is shared across all subscribers and pauses when the window is
 * blurred or the document is hidden, eliminating background GPU churn.
 */
export function useTickRef(onTick: (now: number) => void) {
  useEffect(() => {
    return tickStore.subscribe(onTick)
  }, [onTick])
}
