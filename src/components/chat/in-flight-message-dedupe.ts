import {
  isAskUserQuestion,
  type ChatMessage,
  type ContentBlock,
  type ToolCall,
} from '@/types/chat'

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

function hasMeaningfulPersistedPayload(message: ChatMessage): boolean {
  if (message.content.trim().length > 0) return true
  if (message.tool_calls.length > 0) return true

  return (message.content_blocks ?? []).some(block => {
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

  // If the last message is an assistant following a user message while we're
  // actively sending, hide it immediately. The backend persists the assistant
  // message to disk before streaming content reaches the frontend, creating a
  // one-render window where the message appears then gets removed by dedupe —
  // causing visible flicker (message count bounces N → N+1 → N).
  if (lastMessage?.role !== 'assistant' || previousMessage?.role !== 'user') {
    return messages
  }

  const hasLiveStreaming =
    options.streamingContent.trim().length > 0 ||
    options.streamingContentBlocks.length > 0 ||
    options.streamingToolCalls.length > 0

  // No live streaming state for this session (e.g. resumed after an app
  // restart, or streaming buffers were cleared by a session switch). Keep a
  // meaningful persisted snapshot visible — hiding it would blank the chat
  // since there is no StreamingMessage content to take its place. Only hide
  // empty placeholders (backend persisted the assistant early).
  if (!hasLiveStreaming) {
    return !hasMeaningfulPersistedPayload(lastMessage)
      ? messages.slice(0, -1)
      : messages
  }

  return isTransientTrailingAssistant(lastMessage, options)
    ? messages.slice(0, -1)
    : messages
}

/**
 * Drop questions from the streaming copy that a rendered message already
 * holds, so one question draws one form (#146).
 *
 * The saved copy wins: it knows the question was answered (a user message
 * follows it). A streaming copy of an earlier turn's question only knows the
 * in-memory answered set, so it would draw a second, open form below the
 * answered one. Returns the inputs unchanged when nothing overlaps.
 */
export function withoutRenderedQuestions(
  messages: ChatMessage[],
  streamingContentBlocks: ContentBlock[],
  streamingToolCalls: ToolCall[]
): { contentBlocks: ContentBlock[]; toolCalls: ToolCall[] } {
  const unchanged = {
    contentBlocks: streamingContentBlocks,
    toolCalls: streamingToolCalls,
  }
  const streamingQuestionIds = new Set(
    streamingToolCalls.filter(isAskUserQuestion).map(toolCall => toolCall.id)
  )
  if (streamingQuestionIds.size === 0) return unchanged

  const rendered = new Set<string>()
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const toolCall of message.tool_calls ?? []) {
      if (streamingQuestionIds.has(toolCall.id)) rendered.add(toolCall.id)
    }
  }
  if (rendered.size === 0) return unchanged

  return {
    contentBlocks: streamingContentBlocks.filter(
      block => block.type !== 'tool_use' || !rendered.has(block.tool_call_id)
    ),
    toolCalls: streamingToolCalls.filter(
      toolCall => !rendered.has(toolCall.id)
    ),
  }
}
