import { describe, expect, it } from 'vitest'
import { resolveDefaultModelForBackend } from './session-defaults'
import type { AppPreferences } from '@/types/preferences'

const preferences = {
  selected_model: 'claude-sonnet-4-6[1m]',
  selected_codex_model: 'gpt-5.5-fast',
  selected_opencode_model: 'opencode/gpt-5.5',
  selected_cursor_model: 'cursor/auto',
  selected_commandcode_model: 'commandcode/deepseek/deepseek-v4-flash',
} as unknown as AppPreferences

describe('resolveDefaultModelForBackend', () => {
  it('uses the Command Code model preference for Command Code sessions', () => {
    expect(resolveDefaultModelForBackend('commandcode', preferences)).toBe(
      'commandcode/deepseek/deepseek-v4-flash'
    )
  })

  it('falls back to CLI default when no Command Code model preference exists', () => {
    expect(
      resolveDefaultModelForBackend('commandcode', {} as AppPreferences)
    ).toBe('commandcode/default')
  })
})
