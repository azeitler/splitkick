import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('session name generation UI', () => {
  it.each([
    'src/components/projects/WorktreeItem.tsx',
    'src/components/chat/SessionChatModal.tsx',
    'src/components/chat/SessionListRow.tsx',
  ])('shows a loading label in %s', file => {
    const source = readFileSync(file, 'utf8')
    expect(source).toContain('namingSessionIds')
    expect(source).toContain('Generating…')
    expect(source).not.toContain('<Loader2')
  })

  it('starts and clears the loading state from backend events', () => {
    const source = readFileSync(
      'src/hooks/useMainWindowEventListeners.ts',
      'utf8'
    )
    expect(source).toContain("'session-naming-started'")
    expect(source).toContain('setSessionNaming(event.payload.session_id, true)')
    expect(source).toContain('setSessionNaming(event.payload.session_id, false)')
  })
})
