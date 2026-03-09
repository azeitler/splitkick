import type { ChatMessage, ContentBlock, ToolCall } from '@/types/chat'

interface InFlightMessageDedupOptions {
  isSending: boolean
  streamingContent: string
  streamingContentBlocks: ContentBlock[]
  streamingToolCalls: ToolCall[]
}

function blocksMatch(
  persistedBlocks: ContentBlock[],
  streamingBlocks: ContentBlock[]
): boolean {
  if (persistedBlocks.length === 0 || streamingBlocks.length === 0) return false
  if (persistedBlocks.length > streamingBlocks.length) return false

  return persistedBlocks.every((block, index) => {
    const streamingBlock = streamingBlocks[index]
    if (!streamingBlock || block.type !== streamingBlock.type) return false

    switch (block.type) {
      case 'text':
        return streamingBlock.type === 'text'
          ? streamingBlock.text.startsWith(block.text)
          : false
      case 'thinking':
        return streamingBlock.type === 'thinking'
          ? streamingBlock.thinking.startsWith(block.thinking)
          : false
      case 'tool_use':
        return streamingBlock.type === 'tool_use'
          ? streamingBlock.tool_call_id === block.tool_call_id
          : false
    }
  })
}

function toolCallsMatch(
  persistedToolCalls: ToolCall[],
  streamingToolCalls: ToolCall[]
): boolean {
  if (persistedToolCalls.length === 0 || streamingToolCalls.length === 0) {
    return false
  }
  if (persistedToolCalls.length > streamingToolCalls.length) return false

  return persistedToolCalls.every((toolCall, index) => {
    const streamingToolCall = streamingToolCalls[index]
    return (
      streamingToolCall?.id === toolCall.id &&
      streamingToolCall.name === toolCall.name
    )
  })
}

function isTransientTrailingAssistant(
  message: ChatMessage,
  options: InFlightMessageDedupOptions
): boolean {
  if (message.id.startsWith('running-')) return true

  const normalizedPersisted = message.content.trim()
  const normalizedStreaming = options.streamingContent.trim()

  if (
    normalizedPersisted &&
    normalizedStreaming &&
    normalizedStreaming.startsWith(normalizedPersisted)
  ) {
    return true
  }

  if (
    blocksMatch(message.content_blocks ?? [], options.streamingContentBlocks)
  ) {
    return true
  }

  return toolCallsMatch(message.tool_calls, options.streamingToolCalls)
}

/**
 * While a session is actively streaming, React Query can briefly contain a
 * persisted assistant snapshot for the same in-flight turn. Hide that trailing
 * assistant so the live StreamingMessage is the only thing rendered.
 */
export function dedupeInFlightAssistantMessage(
  messages: ChatMessage[],
  options: InFlightMessageDedupOptions
): ChatMessage[] {
  if (!options.isSending || messages.length < 2) return messages

  const lastMessage = messages[messages.length - 1]
  const previousMessage = messages[messages.length - 2]

  const hasLiveStreaming =
    options.streamingContent.trim().length > 0 ||
    options.streamingContentBlocks.length > 0 ||
    options.streamingToolCalls.length > 0

  if (
    !hasLiveStreaming ||
    lastMessage?.role !== 'assistant' ||
    previousMessage?.role !== 'user'
  ) {
    return messages
  }

  return isTransientTrailingAssistant(lastMessage, options)
    ? messages.slice(0, -1)
    : messages
}
