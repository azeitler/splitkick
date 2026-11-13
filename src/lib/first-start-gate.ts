import { useEffect, useState } from 'react'
import { useUIStore } from '@/store/ui-store'

/**
 * The first start is one linear flow: the setup dialog, then the feature tour.
 * While it runs, nothing else may open on top (update prompt, MCP intro,
 * startup toasts with actions). Those surfaces wait for `useFirstStartIdle()`.
 */
export interface FirstStartFlowState {
  onboardingOpen: boolean
  featureTourOpen: boolean
}

export function isFirstStartFlowActive(state: FirstStartFlowState): boolean {
  return state.onboardingOpen || state.featureTourOpen
}

/**
 * Time the flow must stay closed before queued surfaces show. The tour opens
 * 300 ms after the setup dialog closes; this gap must not let them through.
 */
export const FIRST_START_SETTLE_MS = 1000

/** True when neither the setup dialog nor the tour is open (and has settled). */
export function useFirstStartIdle(): boolean {
  const active = useUIStore(isFirstStartFlowActive)
  const [settled, setSettled] = useState(!active)

  useEffect(() => {
    if (active) return
    const timer = setTimeout(() => setSettled(true), FIRST_START_SETTLE_MS)
    return () => {
      clearTimeout(timer)
      setSettled(false)
    }
  }, [active])

  return !active && settled
}
