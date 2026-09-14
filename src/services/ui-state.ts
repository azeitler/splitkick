import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { invoke } from '@/lib/transport'
import { queryClient } from '@/lib/query-client'
import { logger } from '@/lib/logger'
import { defaultUIState, type UIState } from '@/types/ui-state'

import { hasBackend, hasBackendTransport } from '@/lib/environment'
import { preserveQueryCacheOnError } from '@/lib/query-error'

const isTauri = hasBackend

// Query keys for UI state
export const uiStateQueryKeys = {
  all: ['ui-state'] as const,
  state: () => [...uiStateQueryKeys.all] as const,
}

// TanStack Query hooks following the architectural patterns
export function useUIState() {
  return useQuery({
    queryKey: uiStateQueryKeys.state(),
    queryFn: async (): Promise<UIState> => {
      // Return defaults when running outside Tauri (e.g., bun run dev in browser)
      if (!hasBackendTransport()) {
        logger.debug('Not in Tauri context, using default UI state')
        return defaultUIState
      }

      try {
        logger.debug('Loading UI state from backend')
        const uiState = await invoke<UIState>('load_ui_state')
        logger.info('UI state loaded successfully', { uiState })
        return uiState
      } catch (error) {
        // Return defaults if UI state file doesn't exist yet
        logger.warn('Failed to load UI state, using defaults', { error })
        return preserveQueryCacheOnError(error)
      }
    },
    staleTime: Infinity, // UI state doesn't need refetching - only updates via setQueryData
    gcTime: 1000 * 60 * 60, // 1 hour
  })
}

/**
 * Write the UI-state blob now, outside the debounced save, and report the
 * outcome to the caller.
 *
 * The debounced `useSaveUIState` path stays silent on failure. A user action
 * that must be confirmed (pinning or starring a session) awaits this instead,
 * so it can revert itself and toast. Deliberately not `mutateAsync`: mutations
 * default to `retry: 1` with backoff, which would delay the error by a second.
 */
export async function saveUIStateNow(uiState: UIState): Promise<void> {
  // Skip persistence when running outside Tauri (e.g., bun run dev in browser)
  if (!isTauri()) {
    logger.debug('Not in Tauri context, UI state not persisted to disk')
    return
  }

  logger.debug('Saving UI state to backend (immediate)')
  await invoke('save_ui_state', { uiState })
  queryClient.setQueryData(uiStateQueryKeys.state(), uiState)
}

export function useSaveUIState() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (uiState: UIState) => {
      try {
        await saveUIStateNow(uiState)
      } catch (error) {
        // Silent fail for UI state saves - don't bother user with errors
        logger.error('Failed to save UI state', { error, uiState })
        throw error
      }
    },
    onSuccess: (_, uiState) => {
      // Update the cache with the new UI state
      queryClient.setQueryData(uiStateQueryKeys.state(), uiState)
      logger.debug('UI state cache updated')
      // No toast for UI state - silent operation
    },
  })
}
