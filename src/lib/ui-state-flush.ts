import { saveUIStateNow } from '@/services/ui-state'
import { useUIStore } from '@/store/ui-store'
import { getCurrentUIState } from '@/lib/ui-state-snapshot'

/** Tail of the write chain, so two blob writes are never in flight together. */
let chain: Promise<void> = Promise.resolve()

/**
 * Persist the whole UI-state blob immediately and report the outcome.
 *
 * Unlike the 500 ms debounced save in `useUIStatePersistence`, this rejects on
 * failure, so a user action can revert itself and show an error.
 *
 * The snapshot is taken when the write starts, not when the caller asks, and
 * writes are serialized. An earlier write can therefore never land after — and
 * undo — a later toggle. The pending debounced save is left alone: its payload
 * is a full snapshot that may carry unrelated changes from the same window,
 * and `save_ui_state` writes a temp file and renames it, so a repeat is cheap.
 */
export function flushUIState(): Promise<void> {
  // Before hydration the stores still hold defaults; writing them would wipe
  // the persisted blob. Nothing was written, so nothing failed.
  if (!useUIStore.getState().uiStateInitialized) return Promise.resolve()

  const next = chain
    .catch(() => undefined)
    .then(() => saveUIStateNow(getCurrentUIState()))
  // Keep the order without leaving an unhandled rejection on the chain.
  chain = next.catch(() => undefined)
  return next
}
