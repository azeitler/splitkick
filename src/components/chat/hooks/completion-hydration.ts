import type { ContentBlock, ToolCall } from '@/types/chat'
import { splitTextAroundPlan } from '../tool-call-utils'

export function hasMeaningfulAssistantPayload(
  content: string,
  contentBlocks: ContentBlock[] = [],
  toolCalls: ToolCall[] = []
): boolean {
  if (content.trim().length > 0) return true
  if (toolCalls.length > 0) return true

  return contentBlocks.some(block => {
    switch (block.type) {
      case 'text':
        return block.text.trim().length > 0
      case 'thinking':
        return block.thinking.trim().length > 0
      case 'tool_use':
        return block.tool_call_id.trim().length > 0
    }
  })
}

export function shouldHydrateCompletedSessionFromBackend(
  content: string,
  contentBlocks: ContentBlock[] = [],
  toolCalls: ToolCall[] = []
): boolean {
  const hasPlanTool = toolCalls.some(tc => tc.name === 'CodexPlan')
  const hasPlanToolBlock = contentBlocks.some(
    block => block.type === 'tool_use' && block.tool_call_id.trim().length > 0
  )
  const extractedPlan = splitTextAroundPlan(content).plan

  if (extractedPlan && (!hasPlanTool || !hasPlanToolBlock)) {
    return true
  }

  return !hasMeaningfulAssistantPayload(content, contentBlocks, toolCalls)
}
