import { useCallback, type RefObject } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useChatStore } from '@/store/chat-store'
import {
  chatQueryKeys,
  markPlanApproved as markPlanApprovedService,
} from '@/services/chat'
import { buildMcpConfigJson } from '@/services/mcp'
import { generateId } from '@/lib/uuid'
import type {
  ChatMessage,
  QueuedMessage,
  ThinkingLevel,
  EffortLevel,
} from '@/types/chat'
import type { Session } from '@/types/chat'
import type { McpServerInfo } from '@/types/chat'

interface UsePlanDialogApprovalParams {
  activeSessionId: string | null | undefined
  activeWorktreeId: string | null | undefined
  activeWorktreePath: string | null | undefined
  pendingPlanMessage: ChatMessage | null | undefined
  selectedModelRef: RefObject<string>
  buildModelRef: RefObject<string | null>
  yoloModelRef: RefObject<string | null>
  selectedProviderRef: RefObject<string | null>
  selectedThinkingLevelRef: RefObject<ThinkingLevel>
  selectedEffortLevelRef: RefObject<EffortLevel>
  useAdaptiveThinkingRef: RefObject<boolean>
  isCodexBackendRef: RefObject<boolean>
  mcpServersDataRef: RefObject<McpServerInfo[] | undefined>
  enabledMcpServersRef: RefObject<string[]>
}

/**
 * Provides plan dialog approval handlers (build + yolo).
 * Deduplicates the 4x-repeated approval callback logic in ChatWindow.
 */
export function usePlanDialogApproval({
  activeSessionId,
  activeWorktreeId,
  activeWorktreePath,
  pendingPlanMessage,
  selectedModelRef,
  buildModelRef,
  yoloModelRef,
  selectedProviderRef,
  selectedThinkingLevelRef,
  selectedEffortLevelRef,
  useAdaptiveThinkingRef,
  isCodexBackendRef,
  mcpServersDataRef,
  enabledMcpServersRef,
}: UsePlanDialogApprovalParams) {
  const queryClient = useQueryClient()

  const approve = useCallback(
    (updatedPlan: string | undefined, mode: 'build' | 'yolo') => {
      if (!activeSessionId || !activeWorktreeId || !activeWorktreePath) return

      // Mark plan as approved if there's a pending plan message
      if (pendingPlanMessage) {
        markPlanApprovedService(
          activeWorktreeId,
          activeWorktreePath,
          activeSessionId,
          pendingPlanMessage.id
        )
        // Optimistically update query cache
        queryClient.setQueryData<Session>(
          chatQueryKeys.session(activeSessionId),
          old => {
            if (!old) return old
            return {
              ...old,
              approved_plan_message_ids: [
                ...(old.approved_plan_message_ids ?? []),
                pendingPlanMessage.id,
              ],
              messages: old.messages.map(msg =>
                msg.id === pendingPlanMessage.id
                  ? { ...msg, plan_approved: true }
                  : msg
              ),
            }
          }
        )
      }

      // Build approval message
      const defaultText =
        mode === 'yolo'
          ? 'Plan approved (yolo mode). Begin implementing all changes immediately without asking for confirmation. Do not re-explain the plan — start writing code.'
          : 'Plan approved. Begin implementing the changes now. Do not re-explain the plan — start writing code.'
      const message = updatedPlan
        ? `I've updated the plan. Please review and execute:\n\n<updated-plan>\n${updatedPlan}\n</updated-plan>`
        : defaultText

      // Queue instead of immediate execution
      const { enqueueMessage, setExecutionMode } = useChatStore.getState()
      setExecutionMode(activeSessionId, mode)

      const modelOverride = mode === 'yolo' ? yoloModelRef.current : buildModelRef.current
      const model = modelOverride ?? selectedModelRef.current
      if (modelOverride && modelOverride !== selectedModelRef.current) {
        toast.info(`Using ${modelOverride} model for ${mode}`)
      }

      const queuedMessage: QueuedMessage = {
        id: generateId(),
        message,
        pendingImages: [],
        pendingFiles: [],
        pendingSkills: [],
        pendingTextFiles: [],
        model,
        provider: selectedProviderRef.current,
        executionMode: mode,
        thinkingLevel: selectedThinkingLevelRef.current,
        effortLevel:
          useAdaptiveThinkingRef.current || isCodexBackendRef.current
            ? selectedEffortLevelRef.current
            : undefined,
        mcpConfig: buildMcpConfigJson(
          mcpServersDataRef.current ?? [],
          enabledMcpServersRef.current
        ),
        queuedAt: Date.now(),
      }

      enqueueMessage(activeSessionId, queuedMessage)
    },
    [
      activeSessionId,
      activeWorktreeId,
      activeWorktreePath,
      pendingPlanMessage,
      queryClient,
      selectedModelRef,
      buildModelRef,
      yoloModelRef,
      selectedProviderRef,
      selectedThinkingLevelRef,
      selectedEffortLevelRef,
      useAdaptiveThinkingRef,
      isCodexBackendRef,
      mcpServersDataRef,
      enabledMcpServersRef,
    ]
  )

  const handlePlanDialogApprove = useCallback(
    (updatedPlan?: string) => approve(updatedPlan, 'build'),
    [approve]
  )

  const handlePlanDialogApproveYolo = useCallback(
    (updatedPlan?: string) => approve(updatedPlan, 'yolo'),
    [approve]
  )

  return { handlePlanDialogApprove, handlePlanDialogApproveYolo }
}
