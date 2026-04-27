import { useCallback, useRef } from 'react'
import { useTickRef } from '@/hooks/useTickRef'
import { formatDuration } from '../time-utils'

interface ElapsedTimeProps {
  startTime: number | null
  fallback?: string
}

/**
 * Renders a live elapsed-time string that ticks every second without causing
 * React re-renders. DOM text is mutated directly via a ref.
 */
export function ElapsedTime({ startTime, fallback = '0s' }: ElapsedTimeProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const onTick = useCallback(() => {
    if (ref.current && startTime != null) {
      ref.current.textContent = formatDuration(Date.now() - startTime)
    }
  }, [startTime])
  useTickRef(onTick)
  return <span ref={ref}>{startTime != null ? formatDuration(Date.now() - startTime) : fallback}</span>
}
