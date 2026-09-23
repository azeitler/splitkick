import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

const modal = read('src/components/chat/SessionChatModal.tsx')
const shortcutRows = read('src/components/chat/SessionShortcutRows.tsx')
const canvasStoreState = read(
  'src/components/chat/hooks/useCanvasStoreState.ts'
)

// The tab bar has no render test, so assert on the source: a tab must show the
// pencil for an unsent message, and must not pay for it on every keystroke.
describe('the draft pencil on a session tab', () => {
  it('marks a tab whose session holds an unsent message', () => {
    expect(modal).toContain('const draftSessionIds = useDraftSessionIds()')
    expect(modal).toContain(
      '{draftSessionIds.has(session.id) && <DraftGlyph />}'
    )
  })

  it('shows it in front of the title, and outside the rename field', () => {
    const glyph = modal.indexOf('{draftSessionIds.has(session.id)')
    const rename = modal.indexOf('renamingSessionId === session.id ? (')
    expect(glyph).toBeGreaterThan(-1)
    expect(glyph).toBeLessThan(rename)
  })

  it('marks a starred or pinned row the same way', () => {
    expect(shortcutRows).toContain(
      'const draftSessionIds = useDraftSessionIds()'
    )
    expect(shortcutRows).toContain(
      '{draftSessionIds.has(shortcut.sessionId) && <DraftGlyph />}'
    )
  })

  // ChatInput writes the draft on every keystroke. useCanvasStoreState hands
  // back a memoised object, so a draft field in there would give every tab and
  // every sidebar row a new reference per character typed.
  it('keeps the draft maps out of the shared canvas store state', () => {
    for (const field of ['inputDrafts', 'pendingImages', 'pendingTextFiles']) {
      expect(canvasStoreState).not.toContain(field)
    }
  })
})
