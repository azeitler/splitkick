import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const readSource = (path: string) =>
  readFileSync(join(process.cwd(), path), 'utf8')

describe('SessionChatModal removal behavior', () => {
  it('uses the delete-aware handler when removing non-last tabs', () => {
    const source = readSource('src/components/chat/SessionChatModal.tsx')
    const start = source.indexOf('const removeSessionTab = useCallback(')
    const end = source.indexOf('\n  const handleTabAuxClick', start)
    const removeSessionTab =
      start === -1 || end === -1 ? '' : source.slice(start, end)

    expect(removeSessionTab).toBeTruthy()
    expect(removeSessionTab).toContain('handleDeleteSession(session.id)')
    expect(removeSessionTab).not.toMatch(
      /else\s*\{[\s\S]*?selectVisualNeighbor\(session\.id\)[\s\S]*?handleArchiveSession\(session\.id\)/
    )
  })
})
