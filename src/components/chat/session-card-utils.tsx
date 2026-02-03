import {
  Clock,
  Eye,
  FileText,
  MessageSquare,
  Shield,
  Sparkles,
  Zap,
} from 'lucide-react'
import {
  isAskUserQuestion,
  isExitPlanMode,
  type Session,
  type ExecutionMode,
  type ToolCall,
  type PermissionDenial,
} from '@/types/chat'
import { findPlanFilePath } from './tool-call-utils'

export type SessionStatus =
  | 'idle'
  | 'planning'
  | 'vibing'
  | 'yoloing'
  | 'waiting'
  | 'review'
  | 'permission'

export interface SessionCardData {
  session: Session
  status: SessionStatus
  executionMode: ExecutionMode
  isSending: boolean
  isWaiting: boolean
  hasExitPlanMode: boolean
  hasQuestion: boolean
  hasPermissionDenials: boolean
  permissionDenialCount: number
  planFilePath: string | null
  planContent: string | null
  pendingPlanMessageId: string | null
}

export const statusConfig: Record<
  SessionStatus,
  {
    icon: React.ReactNode
    label: string
    bgClass: string
    textClass: string
  }
> = {
  idle: {
    icon: <MessageSquare className="h-3.5 w-3.5" />,
    label: 'Idle',
    bgClass: 'bg-muted',
    textClass: 'text-muted-foreground',
  },
  planning: {
    icon: <FileText className="h-3.5 w-3.5" />,
    label: 'Planning',
    bgClass: 'bg-primary/20',
    textClass: 'text-primary',
  },
  vibing: {
    icon: <Sparkles className="h-3.5 w-3.5" />,
    label: 'Vibing',
    bgClass: 'bg-primary/20',
    textClass: 'text-primary',
  },
  yoloing: {
    icon: <Zap className="h-3.5 w-3.5" />,
    label: 'Yoloing',
    bgClass: 'bg-red-500/20',
    textClass: 'text-red-600 dark:text-red-400',
  },
  waiting: {
    icon: <Clock className="h-3.5 w-3.5" />,
    label: 'Waiting',
    bgClass: 'bg-yellow-500/20',
    textClass: 'text-yellow-600 dark:text-yellow-400',
  },
  review: {
    icon: <Eye className="h-3.5 w-3.5" />,
    label: 'Review',
    bgClass: 'bg-yellow-500/20',
    textClass: 'text-yellow-600 dark:text-yellow-400',
  },
  permission: {
    icon: <Shield className="h-3.5 w-3.5" />,
    label: 'Permission',
    bgClass: 'bg-yellow-500/20',
    textClass: 'text-yellow-600 dark:text-yellow-400',
  },
}

export interface ChatStoreState {
  sendingSessionIds: Record<string, boolean>
  executingModes: Record<string, ExecutionMode>
  executionModes: Record<string, ExecutionMode>
  activeToolCalls: Record<string, ToolCall[]>
  answeredQuestions: Record<string, Set<string>>
  waitingForInputSessionIds: Record<string, boolean>
  reviewingSessions: Record<string, boolean>
  pendingPermissionDenials: Record<string, PermissionDenial[]>
}

export function computeSessionCardData(
  session: Session,
  storeState: ChatStoreState
): SessionCardData {
  const {
    sendingSessionIds,
    executingModes,
    executionModes,
    activeToolCalls,
    answeredQuestions,
    waitingForInputSessionIds,
    reviewingSessions,
    pendingPermissionDenials,
  } = storeState

  const sessionSending = sendingSessionIds[session.id] ?? false
  const toolCalls = activeToolCalls[session.id] ?? []
  const answeredSet = answeredQuestions[session.id]

  // Check streaming tool calls for waiting state
  const hasStreamingQuestion = toolCalls.some(
    tc => isAskUserQuestion(tc) && !answeredSet?.has(tc.id)
  )
  const hasStreamingExitPlan = toolCalls.some(
    tc => isExitPlanMode(tc) && !answeredSet?.has(tc.id)
  )

  // Check persisted session state for waiting status
  let hasPendingQuestion = false
  let hasPendingExitPlan = false
  let planContent: string | null = null

  // Use persisted plan_file_path from session metadata (primary source)
  let planFilePath: string | null = session.plan_file_path ?? null
  // Use persisted pending_plan_message_id (primary source for Canvas view)
  let pendingPlanMessageId: string | null =
    session.pending_plan_message_id ?? null

  // Helper to extract inline plan from ExitPlanMode tool call
  const getInlinePlan = (tcs: typeof toolCalls): string | null => {
    const exitPlanTool = tcs.find(isExitPlanMode)
    if (!exitPlanTool) return null
    const input = exitPlanTool.input as { plan?: string } | undefined
    return input?.plan ?? null
  }

  // Use persisted waiting_for_input flag from session metadata
  const persistedWaitingForInput = session.waiting_for_input ?? false

  // Check if there are approved plan message IDs
  const approvedPlanIds = new Set(session.approved_plan_message_ids ?? [])

  if (!sessionSending) {
    const messages = session.messages

    // Try to find plan file path from messages if not in persisted state
    if (!planFilePath) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i]
        if (msg?.tool_calls) {
          const path = findPlanFilePath(msg.tool_calls)
          if (path) {
            planFilePath = path
            break
          }
        }
      }
    }

    // Check the last assistant message for pending questions/plans
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg?.role === 'assistant' && msg.tool_calls) {
        // Check for unanswered questions
        hasPendingQuestion = msg.tool_calls.some(
          tc => isAskUserQuestion(tc) && !answeredSet?.has(tc.id)
        )
        // Check for unanswered ExitPlanMode (not approved)
        const hasExitPlan = msg.tool_calls.some(isExitPlanMode)
        if (hasExitPlan && !msg.plan_approved && !approvedPlanIds.has(msg.id)) {
          hasPendingExitPlan = true
          pendingPlanMessageId = msg.id
          // Check for inline plan content
          if (!planFilePath) {
            planContent = getInlinePlan(msg.tool_calls)
          }
        }
        break // Only check the last assistant message
      }
    }
  }

  // Also check for plan file/content in streaming tool calls
  if (toolCalls.length > 0) {
    const streamingPlanPath = findPlanFilePath(toolCalls)
    if (streamingPlanPath) {
      planFilePath = streamingPlanPath
    } else if (!planFilePath) {
      planContent = getInlinePlan(toolCalls)
    }
  }

  // Use persisted waiting state as fallback when messages aren't loaded
  const isExplicitlyWaiting = waitingForInputSessionIds[session.id] ?? false
  const isWaitingFromMessages =
    hasStreamingQuestion ||
    hasStreamingExitPlan ||
    hasPendingQuestion ||
    hasPendingExitPlan
  const isWaiting =
    isWaitingFromMessages || isExplicitlyWaiting || persistedWaitingForInput

  // hasExitPlanMode should also consider persisted state
  // Use waiting_for_input_type to disambiguate when messages haven't loaded yet
  // For backwards compatibility: if type is not set, infer from pending_plan_message_id
  // - If pending_plan_message_id exists → it's a plan
  // - If waiting but no pending_plan_message_id → it's likely a question
  const inferredWaitingType =
    session.waiting_for_input_type ?? (pendingPlanMessageId ? 'plan' : 'question')
  const hasExitPlanMode =
    hasStreamingExitPlan ||
    hasPendingExitPlan ||
    (persistedWaitingForInput && inferredWaitingType === 'plan')
  const hasQuestion =
    hasStreamingQuestion ||
    hasPendingQuestion ||
    (persistedWaitingForInput && inferredWaitingType === 'question')

  // Check for pending permission denials
  const sessionDenials = pendingPermissionDenials[session.id] ?? []
  const persistedDenials = session.pending_permission_denials ?? []
  const hasPermissionDenials =
    sessionDenials.length > 0 || persistedDenials.length > 0
  const permissionDenialCount =
    sessionDenials.length > 0 ? sessionDenials.length : persistedDenials.length

  // Execution mode
  const executionMode = sessionSending
    ? (executingModes[session.id] ?? executionModes[session.id] ?? 'plan')
    : (executionModes[session.id] ?? 'plan')

  // Determine status
  let status: SessionStatus = 'idle'
  if (hasPermissionDenials) {
    status = 'permission'
  } else if (isWaiting) {
    status = 'waiting'
  } else if (reviewingSessions[session.id]) {
    status = 'review'
  } else if (sessionSending && executionMode === 'plan') {
    status = 'planning'
  } else if (sessionSending && executionMode === 'build') {
    status = 'vibing'
  } else if (sessionSending && executionMode === 'yolo') {
    status = 'yoloing'
  }

  return {
    session,
    status,
    executionMode: executionMode as ExecutionMode,
    isSending: sessionSending,
    isWaiting,
    hasExitPlanMode,
    hasQuestion,
    hasPermissionDenials,
    permissionDenialCount,
    planFilePath,
    planContent,
    pendingPlanMessageId,
  }
}
