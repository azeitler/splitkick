import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

describe('SessionChatModal responsive header actions', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, 'SessionChatModal.tsx'),
    'utf8'
  )

  it('keeps badges and inline actions for extra-wide windows only', () => {
    expect(source).toMatch(/hidden items-center gap-2 2xl:flex/)
    expect(source).toMatch(/hidden 2xl:flex items-center gap-1/)
  })

  it('routes compact terminal and browser actions through the worktree menu', () => {
    expect(source).toContain('onToggleTerminal={handleToggleModalTerminal}')
    expect(source).toMatch(
      /onToggleBrowser=\{\s*isNativeApp\(\) \? handleToggleModalBrowser : undefined\s*\}/
    )
  })
})
