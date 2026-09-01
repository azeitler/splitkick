import type { ChatMessage } from '@/types/chat'

type MessageRoleOnly = Pick<ChatMessage, 'role'>

/** Number of recent prompts compact view renders before hiding the rest. */
export const DEFAULT_VISIBLE_PROMPTS = 10

/** Number of extra prompts revealed per scroll-up (or button click). */
export const REVEAL_PROMPT_BATCH = 10

export interface CompactHistoryWindow {
  /** First message index shown while compact history is collapsed. */
  startIndex: number
  /** Number of older user prompts hidden before startIndex. */
  hiddenPromptCount: number
}

/**
 * In compact mode, show only the most recent `promptCount` prompts/runs.
 *
 * A run starts at a user message, so the window starts at the `promptCount`-th
 * user message counted back from the end. If a recovered/partial session has no
 * user message, keep the latest message visible so the chat never blanks.
 */
export function getRecentPromptsWindow(
  messages: readonly MessageRoleOnly[],
  promptCount: number = DEFAULT_VISIBLE_PROMPTS
): CompactHistoryWindow {
  if (messages.length === 0) {
    return { startIndex: 0, hiddenPromptCount: 0 }
  }

  const wanted = Math.max(1, promptCount)
  let startIndex = messages.length - 1
  let seenPrompts = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role !== 'user') continue
    seenPrompts++
    startIndex = i
    if (seenPrompts === wanted) break
  }

  let hiddenPromptCount = 0
  for (let i = 0; i < startIndex; i++) {
    if (messages[i]?.role === 'user') hiddenPromptCount++
  }

  return { startIndex, hiddenPromptCount }
}

export function remapIndexForWindow(index: number, startIndex: number): number {
  return index >= startIndex ? index - startIndex : -1
}
