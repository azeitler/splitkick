import { describe, expect, it } from 'vitest'
import { isClaudeUsageRenewing } from './claude-cli'
import type { ClaudeUsageSnapshot } from '@/types/claude-cli'

const stored = (renewing?: boolean): ClaudeUsageSnapshot => ({
  planType: 'max',
  session: null,
  weekly: null,
  sonnetWeekly: null,
  extraUsageSpent: null,
  extraUsageLimit: null,
  fetchedAt: 1,
  renewing,
})

describe('isClaudeUsageRenewing (#134)', () => {
  it('is true for stored figures while the token renews', () => {
    expect(isClaudeUsageRenewing(stored(true), null)).toBe(true)
  })

  it('is true for the Updating message with no stored figures', () => {
    expect(isClaudeUsageRenewing(undefined, 'Updating usage…')).toBe(true)
    expect(
      isClaudeUsageRenewing(undefined, new Error('Updating usage…'))
    ).toBe(true)
  })

  it('is false for live figures, older backends and other errors', () => {
    expect(isClaudeUsageRenewing(stored(false), null)).toBe(false)
    expect(isClaudeUsageRenewing(stored(undefined), null)).toBe(false)
    expect(
      isClaudeUsageRenewing(
        undefined,
        'Not used recently. Usage shows after the next run with this account.'
      )
    ).toBe(false)
  })
})
