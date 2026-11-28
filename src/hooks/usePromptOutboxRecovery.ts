import { useEffect } from 'react'
import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'
import { isBackendOffline, useBackendOffline } from '@/lib/backend-online'
import {
  noteInputDraftChanged,
  recoverOutbox,
  useOutboxStore,
} from '@/lib/prompt-outbox'

/**
 * App-level driver of the prompt outbox: checks unconfirmed prompts against
 * the backend whenever it is reachable (after a reload, after a reconnect,
 * after a failed call), and lets restored prompts go once their input draft
 * is safe in the backend.
 */
export function usePromptOutboxRecovery() {
  const offline = useBackendOffline()
  const entries = useOutboxStore(state => state.entries)
  const inFlight = useOutboxStore(state => state.inFlight)
  // The saved UI state brings back the input drafts. A restore before that
  // would be overwritten by it.
  const hydrated = useUIStore(state => state.uiStateInitialized)

  useEffect(() => {
    if (!hydrated || offline || Object.keys(entries).length === 0) return
    void recoverOutbox()
  }, [hydrated, offline, entries, inFlight])

  useEffect(
    () =>
      useChatStore.subscribe((state, prev) => {
        if (state.inputDrafts === prev.inputDrafts) return
        // The hydration replaces the drafts; that is not an edit.
        if (!useUIStore.getState().uiStateInitialized) return
        const { entries } = useOutboxStore.getState()
        const online = !isBackendOffline()
        for (const sessionId of new Set(
          Object.values(entries).map(e => e.sessionId)
        )) {
          const draft = state.inputDrafts[sessionId] ?? ''
          if (draft !== (prev.inputDrafts[sessionId] ?? '')) {
            noteInputDraftChanged(sessionId, draft, online)
          }
        }
      }),
    []
  )
}
