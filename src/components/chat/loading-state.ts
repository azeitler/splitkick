import type { QueryClient, QueryKey } from '@tanstack/react-query'

/**
 * What a loading view says. A load that never answers must not look frozen:
 * after `SLOW_LOADING_MS` the view says why it still waits and offers Retry,
 * and a failed load says so instead of loading forever.
 */

/** How long a load may take before the view explains the wait. */
export const SLOW_LOADING_MS = 4000

export type LoadingPhase = 'loading' | 'slow' | 'error'

export interface LoadingCopy {
  title: string
  detail: string | null
  showRetry: boolean
}

export function loadingPhase({
  isError,
  isSlow,
}: {
  isError: boolean
  isSlow: boolean
}): LoadingPhase {
  if (isError) return 'error'
  return isSlow ? 'slow' : 'loading'
}

/**
 * @param subject - what loads, for example "session" or "project".
 * @param connected - whether the backend connection is up. Always true for
 *   the native app on its own backend.
 */
export function describeLoadingState({
  phase,
  subject,
  connected,
  errorMessage,
}: {
  phase: LoadingPhase
  subject: string
  connected: boolean
  errorMessage?: string | null
}): LoadingCopy {
  const lost = 'Connection lost. Reconnecting…'
  switch (phase) {
    case 'loading':
      return { title: `Loading ${subject}…`, detail: null, showRetry: false }
    case 'slow':
      return {
        title: `Loading ${subject}…`,
        detail: connected ? 'This is taking longer than usual…' : lost,
        showRetry: true,
      }
    case 'error':
      return {
        title: `Could not load the ${subject}.`,
        detail: connected ? (errorMessage ?? null) : lost,
        showRetry: true,
      }
  }
}

/**
 * Retry a load that may still hang. `refetch()` joins a request in flight
 * while the query has no data yet, so it cannot unstick a first load that
 * never answers. Cancel that request first, then fetch again.
 */
export async function retryQuery(
  queryClient: QueryClient,
  queryKey: QueryKey
): Promise<void> {
  await queryClient.cancelQueries({ queryKey, exact: true })
  await queryClient.refetchQueries({ queryKey, exact: true })
}
