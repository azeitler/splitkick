import type { ChatMessage } from '@/types/chat'

/**
 * Format milliseconds as a compact duration with a unit indicator.
 *
 * The leading field never carries a padding zero, so the unit letter is what
 * tells you the scale. Examples: "0s", "23s", "2:25m", "1:03h"
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}h`
  if (minutes > 0) return `${minutes}:${String(seconds).padStart(2, '0')}m`

  return `${seconds}s`
}

/**
 * Returns the assistant runtime to display for a message.
 *
 * Prefer the in-memory completed duration for the just-finished final assistant
 * response. After reload, fall back to the persisted user→assistant timestamp
 * delta when it looks like a single prompt run.
 */
export function getAssistantDurationMs(
  messages: ChatMessage[],
  index: number,
  completedDurationMs?: number | null
): number | null {
  const message = messages[index]
  if (message?.role !== 'assistant') return null

  if (index === messages.length - 1 && completedDurationMs != null) {
    return completedDurationMs
  }

  if (index <= 0) return null

  const prevMessage = messages[index - 1]
  if (prevMessage?.role !== 'user') return null

  const deltaSecs = message.timestamp - prevMessage.timestamp
  if (deltaSecs <= 0 || deltaSecs >= 3600) return null

  return deltaSecs * 1000
}
