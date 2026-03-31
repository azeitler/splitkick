import { useEffect, useMemo, useState } from 'react'
import { isTodoWrite, isPlanToolCall } from '@/types/chat'
import type {
  ToolCall,
  ChatMessage,
  CodexAgent,
  Todo,
  PlanToolInput,
  PlanStep,
} from '@/types/chat'

/** Convert plan steps to Todo format for display in TodoWidget */
function planStepsToTodos(steps: PlanStep[]): Todo[] {
  return steps.map(step => ({
    content: step.step,
    activeForm: step.step,
    status:
      step.status === 'completed'
        ? 'completed'
        : step.status === 'in_progress'
          ? 'in_progress'
          : 'pending',
  }))
}

/** Extract todos from plan tool call steps (fallback when no TodoWrite exists) */
function extractPlanTodos(toolCalls: ToolCall[]): Todo[] {
  for (let i = toolCalls.length - 1; i >= 0; i--) {
    const tc = toolCalls[i]
    if (tc && isPlanToolCall(tc)) {
      const input = tc.input as PlanToolInput | undefined
      if (input?.steps?.length) {
        return planStepsToTodos(input.steps)
      }
    }
  }
  return []
}

interface UseActiveTodosAndAgentsParams {
  activeSessionId: string | null | undefined
  isSending: boolean
  currentToolCalls: ToolCall[]
  lastAssistantMessage: ChatMessage | undefined
}

/**
 * Extracts active todos and agents from streaming tool calls or last assistant message.
 * Includes dismissal state management for both.
 */
export function useActiveTodosAndAgents({
  activeSessionId,
  isSending,
  currentToolCalls,
  lastAssistantMessage,
}: UseActiveTodosAndAgentsParams) {
  // Track which message's todos were dismissed
  const [dismissedTodoMessageId, setDismissedTodoMessageId] = useState<
    string | null
  >(null)

  // Get active todos from streaming tool calls OR last assistant message
  const {
    todos: activeTodos,
    sourceMessageId: todoSourceMessageId,
    isFromStreaming: todoIsFromStreaming,
  } = useMemo(() => {
    if (!activeSessionId)
      return { todos: [], sourceMessageId: null, isFromStreaming: false }

    if (isSending && currentToolCalls.length > 0) {
      // Prefer TodoWrite tool calls
      for (let i = currentToolCalls.length - 1; i >= 0; i--) {
        const tc = currentToolCalls[i]
        if (tc && isTodoWrite(tc)) {
          return {
            todos: tc.input.todos,
            sourceMessageId: null,
            isFromStreaming: true,
          }
        }
      }
      // Fall back to plan steps (Codex plans surface steps as todos)
      const planTodos = extractPlanTodos(currentToolCalls)
      if (planTodos.length > 0) {
        return {
          todos: planTodos,
          sourceMessageId: null,
          isFromStreaming: true,
        }
      }
    }

    if (lastAssistantMessage?.tool_calls) {
      // Prefer TodoWrite tool calls
      for (let i = lastAssistantMessage.tool_calls.length - 1; i >= 0; i--) {
        const tc = lastAssistantMessage.tool_calls[i]
        if (tc && isTodoWrite(tc)) {
          return {
            todos: tc.input.todos,
            sourceMessageId: lastAssistantMessage.id,
            isFromStreaming: false,
          }
        }
      }
      // Fall back to plan steps
      const planTodos = extractPlanTodos(lastAssistantMessage.tool_calls)
      if (planTodos.length > 0) {
        return {
          todos: planTodos,
          sourceMessageId: lastAssistantMessage.id,
          isFromStreaming: false,
        }
      }
    }

    return { todos: [], sourceMessageId: null, isFromStreaming: false }
  }, [activeSessionId, isSending, currentToolCalls, lastAssistantMessage])

  // Track which message's agents were dismissed
  const [dismissedAgentMessageId, setDismissedAgentMessageId] = useState<
    string | null
  >(null)

  // Get active agents from SpawnAgent tool calls
  const {
    agents: activeAgents,
    sourceMessageId: agentSourceMessageId,
    isFromStreaming: agentIsFromStreaming,
  } = useMemo(() => {
    if (!activeSessionId)
      return { agents: [], sourceMessageId: null, isFromStreaming: false }

    const toolCalls =
      isSending && currentToolCalls.length > 0
        ? currentToolCalls
        : (lastAssistantMessage?.tool_calls ?? [])

    const agents: CodexAgent[] = []
    for (const tc of toolCalls) {
      if (tc.name === 'SpawnAgent') {
        const input = tc.input as Record<string, unknown>
        const prompt = (input.prompt as string) ?? ''
        const truncated =
          prompt.length > 80 ? prompt.substring(0, 80) + '...' : prompt
        let status: CodexAgent['status'] = 'in_progress'
        if (tc.output && !isSending) {
          const out = tc.output as string
          if (out.includes('errored')) {
            status = 'errored'
          } else {
            status = 'completed'
          }
        }
        agents.push({ id: tc.id, prompt: truncated, status })
      }
    }

    const sourceId =
      isSending && currentToolCalls.length > 0
        ? null
        : (lastAssistantMessage?.id ?? null)
    return {
      agents,
      sourceMessageId: sourceId,
      isFromStreaming: isSending && currentToolCalls.length > 0,
    }
  }, [activeSessionId, isSending, currentToolCalls, lastAssistantMessage])

  // Auto-clear todo dismissal on new streaming todos
  useEffect(() => {
    if (isSending && activeTodos.length > 0 && todoSourceMessageId === null) {
      if (dismissedTodoMessageId !== '__streaming__') {
        queueMicrotask(() => setDismissedTodoMessageId(null))
      }
    }
    if (
      !isSending &&
      todoSourceMessageId !== null &&
      dismissedTodoMessageId === '__streaming__'
    ) {
      queueMicrotask(() => setDismissedTodoMessageId(todoSourceMessageId))
    }
  }, [
    isSending,
    activeTodos.length,
    todoSourceMessageId,
    dismissedTodoMessageId,
  ])

  // Auto-clear agent dismissal on new streaming agents
  useEffect(() => {
    if (isSending && activeAgents.length > 0 && agentSourceMessageId === null) {
      if (dismissedAgentMessageId !== '__streaming__') {
        queueMicrotask(() => setDismissedAgentMessageId(null))
      }
    } else if (
      !isSending &&
      agentSourceMessageId !== null &&
      dismissedAgentMessageId === '__streaming__'
    ) {
      queueMicrotask(() => setDismissedAgentMessageId(agentSourceMessageId))
    }
  }, [
    isSending,
    activeAgents.length,
    agentSourceMessageId,
    dismissedAgentMessageId,
  ])

  return {
    activeTodos,
    todoSourceMessageId,
    todoIsFromStreaming,
    dismissedTodoMessageId,
    setDismissedTodoMessageId,
    activeAgents,
    agentSourceMessageId,
    agentIsFromStreaming,
    dismissedAgentMessageId,
    setDismissedAgentMessageId,
  }
}
