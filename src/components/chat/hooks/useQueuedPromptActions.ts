import { useCallback, useEffect, useRef } from 'react'
import {
  cancelChatMessage,
  persistMoveQueuedFront,
  persistRemoveQueued,
  persistUpdateQueued,
  steerCodexTurn,
  steerGrokTurn,
  steerOpencodeTurn,
  steerPiTurn,
} from '@/services/chat'
import { buildMessageWithRefs } from '@/components/chat/message-with-refs'
import { useChatStore } from '@/store/chat-store'
import { logger } from '@/lib/logger'
import { invoke } from '@/lib/transport'
import { addUnsentPrompt } from '@/lib/prompt-outbox'
import { generateId } from '@/lib/uuid'
import type { QueuedMessage } from '@/types/chat'

/** The chat window that shows the queue: it knows its own worktree. */
export interface QueueWorktreeFallback {
  worktreeId?: string | null
  worktreePath?: string | null
}

/**
 * The session's worktree from the store. A session that the store has no
 * entry for (yet) still belongs to the worktree of the chat window that shows
 * its queue; without that fallback every queue action did nothing, silently.
 */
function resolveWorktree(sessionId: string, fallback?: QueueWorktreeFallback) {
  const { sessionWorktreeMap, worktreePaths } = useChatStore.getState()
  const worktreeId = sessionWorktreeMap[sessionId] ?? fallback?.worktreeId
  const worktreePath =
    (worktreeId ? worktreePaths[worktreeId] : undefined) ??
    (worktreeId && worktreeId === fallback?.worktreeId
      ? fallback.worktreePath
      : undefined)
  return {
    worktreeId: worktreeId ?? undefined,
    worktreePath: worktreePath ?? undefined,
  }
}

/**
 * Any attachment kind serializes to a path ref via buildMessageWithRefs, so
 * text-only mid-turn steer (Grok/Pi/OpenCode) can carry all of them. Codex
 * also accepts structured attachment input when present.
 */
function hasAttachments(msg: QueuedMessage): boolean {
  return (
    msg.pendingImages.length > 0 ||
    msg.pendingFiles.length > 0 ||
    msg.pendingSkills.length > 0 ||
    msg.pendingTextFiles.length > 0
  )
}

/**
 * Actions for the queued prompts panel: remove a queued prompt, or send a
 * specific queued prompt immediately.
 *
 * "Send now" is backend-aware:
 * - Idle session: promote the message to the queue front and let the queue
 *   processor send it (reuses the existing atomic dequeue + send path).
 * - Busy Codex/Pi session: inject the text into the running turn via the
 *   backend steering API. Falls back to cancel+send when the turn already
 *   ended or the message has attachments.
 * - Busy other backends: promote to front, cancel the current run — the
 *   queue processor auto-sends the promoted message once the session is idle.
 */
export function useQueuedPromptActions(fallback?: QueueWorktreeFallback) {
  // A ref keeps the callbacks stable while the window's worktree changes.
  const fallbackRef = useRef(fallback)
  const fallbackWorktreeId = fallback?.worktreeId
  const fallbackWorktreePath = fallback?.worktreePath
  useEffect(() => {
    fallbackRef.current = {
      worktreeId: fallbackWorktreeId,
      worktreePath: fallbackWorktreePath,
    }
  }, [fallbackWorktreeId, fallbackWorktreePath])

  const handleRemoveQueuedMessage = useCallback(
    (sessionId: string, messageId: string) => {
      useChatStore.getState().removeQueuedMessage(sessionId, messageId)
      // Persist removal to backend for cross-client sync
      const { worktreeId, worktreePath } = resolveWorktree(
        sessionId,
        fallbackRef.current
      )
      if (worktreeId && worktreePath) {
        persistRemoveQueued(worktreeId, worktreePath, sessionId, messageId)
      }
    },
    []
  )

  const handleEditQueuedMessage = useCallback(
    async (sessionId: string, messageId: string, message: string) => {
      const trimmed = message.trim()
      if (!trimmed) return

      const store = useChatStore.getState()
      const msg = store
        .getQueuedMessages(sessionId)
        .find(m => m.id === messageId)
      if (!msg) return

      const { worktreeId, worktreePath } = resolveWorktree(
        sessionId,
        fallbackRef.current
      )
      if (!worktreeId || !worktreePath) return

      // The editor is closed already. When the edit does not reach the queue,
      // keep the edited text as an unsent message instead of dropping it.
      const keepEdit = () => {
        const edited = { ...msg, id: generateId(), message: trimmed }
        addUnsentPrompt({
          id: edited.id,
          sessionId,
          worktreeId,
          worktreePath,
          message: buildMessageWithRefs(edited),
          queued: edited,
        })
      }

      try {
        const updated = await persistUpdateQueued(
          worktreeId,
          worktreePath,
          sessionId,
          messageId,
          trimmed
        )
        if (!updated) {
          // Another client already dequeued it — drop the stale local copy.
          store.removeQueuedMessage(sessionId, messageId)
          if (trimmed !== msg.message) keepEdit()
          return
        }
        store.updateQueuedMessage(sessionId, messageId, trimmed)
      } catch (error) {
        logger.error('Failed to persist queued edit', {
          error,
          sessionId,
          messageId,
        })
        keepEdit()
      }
    },
    []
  )

  const handleSendQueuedNow = useCallback(
    async (sessionId: string, messageId: string) => {
      const store = useChatStore.getState()
      const { worktreeId, worktreePath } = resolveWorktree(
        sessionId,
        fallbackRef.current
      )
      if (!worktreeId || !worktreePath) {
        logger.warn('Send now: no worktree for the session', { sessionId })
        return
      }

      const msg = store
        .getQueuedMessages(sessionId)
        .find(m => m.id === messageId)
      if (!msg) {
        logger.warn('Send now: message is not in the queue', {
          sessionId,
          messageId,
        })
        return
      }

      const isSending = !!store.sendingSessionIds[sessionId]
      const isWaiting = !!store.waitingForInputSessionIds[sessionId]

      // Idle session: promote + force-process so the queue processor sends it.
      if (!isSending && !isWaiting) {
        const moved = await persistMoveQueuedFront(
          worktreeId,
          worktreePath,
          sessionId,
          messageId
        )
        if (!moved) {
          logger.warn('Send now: the backend queue does not hold the message', {
            sessionId,
            messageId,
          })
          return
        }
        store.moveQueuedMessageFront(sessionId, messageId)
        // This client can be wrong about "idle" (a missed event, a run started
        // elsewhere). The backend knows: it cancels a run that is active and
        // then sends the promoted message itself, and it answers false for a
        // session that really is idle.
        const cancelled = await cancelChatMessage(sessionId, worktreeId)
        if (!cancelled) useChatStore.getState().forceProcessQueue(sessionId)
        return
      }

      // Busy Codex/OpenCode/Pi/Grok session: steer the running turn. All
      // attachments become path refs via buildMessageWithRefs; Codex also gets
      // structured attachment input when present.
      const backend = store.selectedBackends[sessionId] ?? 'claude'
      if (
        (backend === 'codex' ||
          backend === 'opencode' ||
          backend === 'pi' ||
          backend === 'grok') &&
        isSending
      ) {
        try {
          const steerMessage = buildMessageWithRefs(msg)
          if (backend === 'pi') {
            await steerPiTurn(worktreeId, sessionId, steerMessage)
          } else if (backend === 'grok') {
            await steerGrokTurn(worktreeId, sessionId, steerMessage)
          } else if (backend === 'opencode') {
            await steerOpencodeTurn(
              worktreeId,
              worktreePath,
              sessionId,
              steerMessage
            )
          } else if (hasAttachments(msg)) {
            await steerCodexTurn(worktreeId, sessionId, steerMessage, msg)
          } else {
            await steerCodexTurn(worktreeId, sessionId, steerMessage)
          }
          handleRemoveQueuedMessage(sessionId, messageId)
          return
        } catch (error) {
          // Turn ended / not started yet — fall through to cancel+send
          logger.debug(`${backend} steer failed, falling back to cancel+send`, {
            error,
            sessionId,
          })
        }
      }

      // Busy (other backends / steer failed): promote, then cancel. The queue
      // processor picks up the promoted head once the cancellation clears the
      // sending state. Abort if another client already dequeued the message.
      const moved = await persistMoveQueuedFront(
        worktreeId,
        worktreePath,
        sessionId,
        messageId
      )
      if (!moved) {
        logger.warn('Send now: the backend queue does not hold the message', {
          sessionId,
          messageId,
        })
        return
      }
      useChatStore.getState().moveQueuedMessageFront(sessionId, messageId)

      if (useChatStore.getState().sendingSessionIds[sessionId]) {
        await cancelChatMessage(sessionId, worktreeId)
      } else {
        // Only waiting for input (plan approval / question) — skip the wait.
        // The backend holds the queue while its waiting flag is set (#111),
        // so clear that first; then the queue processor can dequeue.
        try {
          await invoke('update_session_state', {
            worktreeId,
            worktreePath,
            sessionId,
            waitingForInput: false,
            waitingForInputType: null,
          })
        } catch (error) {
          logger.error('Failed to clear waiting state for send now', {
            error,
            sessionId,
          })
        }
        useChatStore.getState().forceProcessQueue(sessionId)
      }
    },
    [handleRemoveQueuedMessage]
  )

  return {
    handleRemoveQueuedMessage,
    handleEditQueuedMessage,
    handleSendQueuedNow,
  }
}
