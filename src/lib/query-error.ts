/** Rethrow query failures so TanStack Query retains the last successful data. */
export function preserveQueryCacheOnError(error: unknown): never {
  throw error
}

/**
 * Check if an error is from a WebSocket disconnect.
 *
 * Web-access clients reload and re-read state from disk after a drop, so a
 * toast about it is noise. Callers suppress their error toast on a match.
 */
export function isWsDisconnectError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error)
  return msg.includes('WebSocket disconnected')
}
