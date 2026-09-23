import { useMemo } from 'react'
import { useChatStore } from '@/store/chat-store'
import type { PendingImage, PendingTextFile } from '@/types/chat'

/**
 * The part of the chat store that tells us a session holds unsent input.
 * `pendingFiles` (@ mentions) and `pendingSkills` (/ mentions) are left out on
 * purpose — both are rebuilt from markers in the draft text, so they never
 * exist without it.
 */
export interface DraftState {
  inputDrafts: Record<string, string>
  pendingImages: Record<string, PendingImage[]>
  pendingTextFiles: Record<string, PendingTextFile[]>
}

/**
 * Sorted, comma-joined ids of every session that holds unsent input.
 *
 * A signature string, not a Set: `ChatInput` writes the draft on every
 * keystroke, and a selector that built a new Set would return a new reference
 * each time and re-render every tab and every sidebar row per character. An
 * identical string settles under Object.is, so typing inside a session that
 * already shows the pencil costs no render at all.
 */
export function selectDraftSignature(state: DraftState): string {
  const ids = new Set<string>()
  for (const [id, text] of Object.entries(state.inputDrafts)) {
    if (text.trim()) ids.add(id)
  }
  for (const [id, images] of Object.entries(state.pendingImages)) {
    if (images.length > 0) ids.add(id)
  }
  for (const [id, files] of Object.entries(state.pendingTextFiles)) {
    if (files.length > 0) ids.add(id)
  }
  return [...ids].sort().join(',')
}

/** The sessions that hold an unsent message, for the draft pencil on a row. */
export function useDraftSessionIds(): ReadonlySet<string> {
  const signature = useChatStore(selectDraftSignature)
  return useMemo(
    () => new Set(signature ? signature.split(',') : []),
    [signature]
  )
}
