import { describe, expect, it } from 'vitest'
import { hasQuestionAnswerOutput } from './chat'

describe('hasQuestionAnswerOutput', () => {
  it('returns false for Claude blocking-tool error output', () => {
    expect(hasQuestionAnswerOutput('Answer questions?')).toBe(false)
    expect(hasQuestionAnswerOutput('Error: Answer questions?')).toBe(false)
  })

  it('returns true for persisted JSON answers', () => {
    expect(
      hasQuestionAnswerOutput(
        JSON.stringify([{ questionIndex: 0, selectedOptions: [1] }])
      )
    ).toBe(true)
  })

  it('returns true for non-JSON backend answer output', () => {
    expect(hasQuestionAnswerOutput('Backyard birds')).toBe(true)
  })
})
