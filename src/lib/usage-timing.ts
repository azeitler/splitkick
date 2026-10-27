/** How often a provider's usage (Claude, Codex, Grok) is checked. */
export const USAGE_REFRESH_MS = 1000 * 60 * 5

/** Shortest wait before the next usage check, whatever the snapshot says. */
const USAGE_MIN_RECHECK_MS = 30_000

interface UsageSnapshot {
  /** Unix seconds when the backend fetched this usage. */
  fetchedAt?: number | null
}

/**
 * Time left until the snapshot is five minutes old, or a full interval when
 * it already is. An old snapshot means the backend could not refresh it (an
 * expired token, a 429, a failed request) and served its cache; its
 * `fetchedAt` stays old. Measured from that, the next check was due at once,
 * and the usage check ran every second.
 */
function usageTimeLeft(snapshot?: UsageSnapshot): number {
  if (!snapshot?.fetchedAt) return USAGE_REFRESH_MS
  const left = snapshot.fetchedAt * 1000 + USAGE_REFRESH_MS - Date.now()
  return left > 0 ? left : USAGE_REFRESH_MS
}

/** TanStack Query `staleTime` for a usage query. */
export function getUsageStaleTime(snapshot?: UsageSnapshot): number {
  if (!snapshot?.fetchedAt) return 0
  return usageTimeLeft(snapshot)
}

/** TanStack Query `refetchInterval` for a usage query. */
export function getUsageRefetchInterval(snapshot?: UsageSnapshot): number {
  return Math.max(USAGE_MIN_RECHECK_MS, usageTimeLeft(snapshot))
}
