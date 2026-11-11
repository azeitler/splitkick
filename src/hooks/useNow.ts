import { useEffect, useState } from 'react'

/**
 * The current time in ms, refreshed every `intervalMs` (default one minute),
 * so relative labels such as "in 2h" or "5m ago" keep ticking without a
 * refetch (#123).
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
