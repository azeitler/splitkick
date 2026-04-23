import { useState, useEffect } from 'react'
import { formatDuration } from '../time-utils'

/**
 * Returns a live elapsed time string (e.g. "23s") that ticks every second.
 * Uses state to store the computed duration, updated via interval, to avoid
 * calling Date.now() during render.
 */
export function useElapsedTime(startTime: number | null): string | null {
  const [elapsed, setElapsed] = useState<number | null>(null)

  useEffect(() => {
    if (startTime == null) {
      setElapsed(null)
      return
    }
    setElapsed(Date.now() - startTime)
    const id = setInterval(() => setElapsed(Date.now() - startTime), 1000)
    return () => clearInterval(id)
  }, [startTime])

  if (elapsed == null) return null
  return formatDuration(elapsed)
}
