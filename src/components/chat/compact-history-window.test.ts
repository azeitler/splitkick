import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VISIBLE_PROMPTS,
  getRecentPromptsWindow,
  remapIndexForWindow,
} from './compact-history-window'

const user = { role: 'user' as const }
const assistant = { role: 'assistant' as const }

/** Build [user, assistant] × count. */
function conversation(promptCount: number) {
  return Array.from({ length: promptCount }, () => [user, assistant]).flat()
}

describe('getRecentPromptsWindow', () => {
  it('returns an empty window for empty message lists', () => {
    expect(getRecentPromptsWindow([], 10)).toEqual({
      startIndex: 0,
      hiddenPromptCount: 0,
    })
  })

  it('starts at the only user prompt when the current run has no answer yet', () => {
    expect(getRecentPromptsWindow([user], 10)).toEqual({
      startIndex: 0,
      hiddenPromptCount: 0,
    })
  })

  it('keeps the latest assistant visible when no user prompt exists', () => {
    expect(getRecentPromptsWindow([assistant, assistant], 10)).toEqual({
      startIndex: 1,
      hiddenPromptCount: 0,
    })
  })

  it('shows the current run only when asked for one prompt', () => {
    expect(
      getRecentPromptsWindow([user, assistant, user, assistant, user], 1)
    ).toEqual({ startIndex: 4, hiddenPromptCount: 2 })
  })

  it('shows the requested number of recent prompts and hides the rest', () => {
    // 10 prompts, keep the last 3 -> window starts at prompt index 7 (message 14)
    expect(getRecentPromptsWindow(conversation(10), 3)).toEqual({
      startIndex: 14,
      hiddenPromptCount: 7,
    })
  })

  it('shows every prompt when fewer exist than requested', () => {
    expect(getRecentPromptsWindow(conversation(4), 10)).toEqual({
      startIndex: 0,
      hiddenPromptCount: 0,
    })
  })

  it('defaults to DEFAULT_VISIBLE_PROMPTS recent prompts', () => {
    const messages = conversation(DEFAULT_VISIBLE_PROMPTS + 5)
    expect(getRecentPromptsWindow(messages)).toEqual({
      startIndex: 10,
      hiddenPromptCount: 5,
    })
  })

  it('treats a non-positive prompt count as the current run', () => {
    expect(getRecentPromptsWindow(conversation(3), 0)).toEqual({
      startIndex: 4,
      hiddenPromptCount: 2,
    })
  })
})

describe('remapIndexForWindow', () => {
  it('hides indices before the compact window', () => {
    expect(remapIndexForWindow(2, 4)).toBe(-1)
  })

  it('remaps visible indices into the sliced message list', () => {
    expect(remapIndexForWindow(5, 4)).toBe(1)
  })
})
