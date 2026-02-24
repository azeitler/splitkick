import { useEffect, useRef } from 'react'
import { useChatStore } from '@/store/chat-store'
import { useSendMessage } from '@/services/chat'
import { usePreferences } from '@/services/preferences'
import { DEFAULT_PARALLEL_EXECUTION_PROMPT } from '@/types/preferences'
import { isTauri } from '@/services/projects'
import { useWsConnectionStatus } from '@/lib/transport'
import type { QueuedMessage } from '@/types/chat'
import { logger } from '@/lib/logger'

// GIT_ALLOWED_TOOLS duplicated from ChatWindow - tools always allowed for git operations
const GIT_ALLOWED_TOOLS = ['Bash', 'Read', 'Glob', 'Grep']

/**
 * Build full message with attachment references for backend
 * Pure function extracted from ChatWindow
 */
function buildMessageWithRefs(queuedMsg: QueuedMessage): string {
  let message = queuedMsg.message

  // Add file references (from @ mentions)
  if (queuedMsg.pendingFiles.length > 0) {
    const fileRefs = queuedMsg.pendingFiles
      .map(
        f => `[File: ${f.relativePath} - Use the Read tool to view this file]`
      )
      .join('\n')
    message = message ? `${message}\n\n${fileRefs}` : fileRefs
  }

  // Add skill references (from / mentions)
  if (queuedMsg.pendingSkills.length > 0) {
    const skillRefs = queuedMsg.pendingSkills
      .map(
        s =>
          `[Skill: ${s.path} - Read and use this skill to guide your response]`
      )
      .join('\n')
    message = message ? `${message}\n\n${skillRefs}` : skillRefs
  }

  // Add image references
  if (queuedMsg.pendingImages.length > 0) {
    const imageRefs = queuedMsg.pendingImages
      .map(
        img =>
          `[Image attached: ${img.path} - Use the Read tool to view this image]`
      )
      .join('\n')
    message = message ? `${message}\n\n${imageRefs}` : imageRefs
  }

  // Add text file references
  if (queuedMsg.pendingTextFiles.length > 0) {
    const textFileRefs = queuedMsg.pendingTextFiles
      .map(
        tf =>
          `[Text file attached: ${tf.path} - Use the Read tool to view this file]`
      )
      .join('\n')
    message = message ? `${message}\n\n${textFileRefs}` : textFileRefs
  }

  return message
}

/**
 * Global queue processor hook - must be at App level so it stays active
 * even when ChatWindow is unmounted (e.g., when viewing a different worktree)
 *
 * Processes queued messages for ALL sessions, not just the active one.
 * This fixes the bug where queued prompts don't execute when the worktree is unfocused.
 */
export function useQueueProcessor(): void {
  const sendMessage = useSendMessage()
  const { data: preferences } = usePreferences()
  // Re-run effect when WS connects so queue processing works in web mode
  const wsConnected = useWsConnectionStatus()

  // Track which sessions we're currently processing to prevent race conditions
  const processingRef = useRef<Set<string>>(new Set())

  // PERFORMANCE: Derived boolean selector — only re-renders when the answer changes,
  // not on every mutation to any key in the underlying records.
  const hasProcessableQueue = useChatStore(state => {
    for (const [sessionId, queue] of Object.entries(state.messageQueues)) {
      if (
        queue &&
        queue.length > 0 &&
        !state.sendingSessionIds[sessionId] &&
        !state.waitingForInputSessionIds[sessionId]
      ) {
        return true
      }
    }
    return false
  })

  useEffect(() => {
    if (!hasProcessableQueue || !isTauri()) return

    // Read fresh state inside effect to avoid subscribing to full records
    const {
      messageQueues,
      sendingSessionIds,
      waitingForInputSessionIds,
      sessionWorktreeMap,
      worktreePaths,
      dequeueMessage,
      addSendingSession,
      setLastSentMessage,
      setError,
      setExecutingMode,
      setSelectedModel,
      getApprovedTools,
      clearStreamingContent,
      clearToolCalls,
      clearStreamingContentBlocks,
      setSessionReviewing,
    } = useChatStore.getState()

    // Process each session's queue
    for (const [sessionId, queue] of Object.entries(messageQueues)) {
      // Skip if queue is empty
      if (!queue || queue.length === 0) continue

      // Skip if already processing this session
      if (processingRef.current.has(sessionId)) continue

      // Skip if session is currently sending
      if (sendingSessionIds[sessionId]) continue

      // Skip if session is waiting for user input (AskUserQuestion/ExitPlanMode)
      if (waitingForInputSessionIds[sessionId]) continue

      const worktreeId = sessionWorktreeMap[sessionId]
      const worktreePath = worktreeId ? worktreePaths[worktreeId] : undefined

      // Skip if we can't find the worktree for this session
      if (!worktreeId || !worktreePath) {
        logger.warn('Queue processor: Cannot find worktree for session', {
          sessionId,
        })
        continue
      }

      // Mark as processing to prevent duplicate processing
      processingRef.current.add(sessionId)

      // Dequeue the message
      const queuedMsg = dequeueMessage(sessionId)
      if (!queuedMsg) {
        processingRef.current.delete(sessionId)
        continue
      }

      logger.info('Queue processor: Processing queued message', {
        sessionId,
        worktreeId,
        messageId: queuedMsg.id,
      })

      // Clear stale streaming state before starting new message
      clearStreamingContent(sessionId)
      clearToolCalls(sessionId)
      clearStreamingContentBlocks(sessionId)

      // Set up session state
      setLastSentMessage(sessionId, queuedMsg.message)
      setError(sessionId, null)
      addSendingSession(sessionId)
      setSessionReviewing(sessionId, false) // Clear stale review state so canvas shows running status
      setExecutingMode(sessionId, queuedMsg.executionMode)
      setSelectedModel(sessionId, queuedMsg.model)

      // Get session-approved tools
      const sessionApprovedTools = getApprovedTools(sessionId)
      const allowedTools =
        sessionApprovedTools.length > 0
          ? [...GIT_ALLOWED_TOOLS, ...sessionApprovedTools]
          : undefined

      // Build full message with attachment refs
      const fullMessage = buildMessageWithRefs(queuedMsg)

      // Send the message
      sendMessage.mutate(
        {
          sessionId,
          worktreeId,
          worktreePath,
          message: fullMessage,
          model: queuedMsg.model,
          executionMode: queuedMsg.executionMode,
          thinkingLevel: queuedMsg.thinkingLevel,
          effortLevel: queuedMsg.effortLevel,
          mcpConfig: queuedMsg.mcpConfig,
          customProfileName: queuedMsg.provider ?? undefined,
          parallelExecutionPrompt:
            preferences?.parallel_execution_prompt_enabled
              ? (preferences.magic_prompts?.parallel_execution ??
                DEFAULT_PARALLEL_EXECUTION_PROMPT)
              : undefined,
          chromeEnabled: preferences?.chrome_enabled ?? false,
          allowedTools,
        },
        {
          onSettled: () => {
            // Clear processing flag when done
            processingRef.current.delete(sessionId)
          },
        }
      )
    }
  }, [
    hasProcessableQueue,
    sendMessage,
    preferences?.parallel_execution_prompt_enabled,
    preferences?.magic_prompts?.parallel_execution,
    preferences?.chrome_enabled,
    wsConnected,
  ])
}
