import { useCallback } from 'react'
import { useEditFollowUps } from '@/services/chat'
import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'
import type { FollowUp } from '@/types/chat'

interface UseFollowUpActionsParams {
  sessionId: string | null
  worktreeId: string | null
  worktreePath: string | null
  /** Sends at once when idle, queues while a run is active. */
  sendTextMessage: (message: string) => void
}

/** Item actions of the follow-up list (#46). */
export function useFollowUpActions({
  sessionId,
  worktreeId,
  worktreePath,
  sendTextMessage,
}: UseFollowUpActionsParams) {
  const onEdit = useEditFollowUps(sessionId, worktreeId, worktreePath)

  /** Put the text into the composer (below any text already there) and tick the item off. */
  const onUse = useCallback(
    (item: FollowUp) => {
      if (!sessionId) return
      const draft = useChatStore.getState().inputDrafts[sessionId] ?? ''
      const text = draft.trim() ? `\n${item.text}` : item.text
      useUIStore.getState().setFollowUpsOpen(false)
      window.dispatchEvent(
        new CustomEvent('append-chat-input', { detail: { text } })
      )
      void onEdit({ kind: 'update', id: item.id, done: true })
    },
    [sessionId, onEdit]
  )

  /** Move the item into the message queue. Offered only while a run is active. */
  const onQueue = useCallback(
    (item: FollowUp) => {
      sendTextMessage(item.text)
      void onEdit({ kind: 'remove', id: item.id })
    },
    [sendTextMessage, onEdit]
  )

  return { onEdit, onUse, onQueue }
}
