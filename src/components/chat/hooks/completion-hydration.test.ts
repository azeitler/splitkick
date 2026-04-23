import { describe, expect, it } from 'vitest'
import { shouldHydrateCompletedSessionFromBackend } from './completion-hydration'

describe('shouldHydrateCompletedSessionFromBackend', () => {
  it('requests hydration when plain-text plan content exists without a CodexPlan tool', () => {
    expect(
      shouldHydrateCompletedSessionFromBackend(
        'Repo inspected.\n\nPlan:\n- Implement changes\n- Add tests',
        [{ type: 'text', text: 'Repo inspected.' }],
        []
      )
    ).toBe(true)
  })

  it('does not request hydration when plan content already has a CodexPlan tool and tool block', () => {
    expect(
      shouldHydrateCompletedSessionFromBackend(
        'Repo inspected.\n\nPlan:\n- Implement changes\n- Add tests',
        [{ type: 'tool_use', tool_call_id: 'plan-1' }],
        [{ id: 'plan-1', name: 'CodexPlan', input: {} }]
      )
    ).toBe(false)
  })
})
