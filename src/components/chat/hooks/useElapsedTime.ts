import { useSyncExternalStore } from 'react'
import { tickStore } from '@/contexts/TickStore'
import { formatDuration } from '../time-utils'

export function useElapsedTime(startTime: number | null): string | null {
  const now = useSyncExternalStore(tickStore.subscribe, tickStore.getSnapshot)
  if (startTime == null) return null
  return formatDuration(now - startTime)
}
