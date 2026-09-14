import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  join(process.cwd(), 'src/components/chat/SessionChatModal.tsx'),
  'utf8'
)

// Escape used to close the session and throw the user back to the project
// page. It is the reflex for dismissing a popover, a menu or an autocomplete,
// so a miss cost the open session mid-sentence.
describe('SessionChatModal and the Escape key', () => {
  it('has no window-level Escape handler', () => {
    expect(source).not.toContain("if (e.key !== 'Escape') return")
    expect(source).not.toMatch(/window\.addEventListener\('keydown'/)
  })

  it('leaves Escape to the dialogs, menus and terminal inside the session', () => {
    // The old handler had to name every one of these to stay out of their way.
    for (const guard of [
      'planDialogOpen',
      'gitDiffModalOpen',
      'contextViewerOpen',
      'data-terminal-root',
    ]) {
      expect(source).not.toContain(`if (${guard}) return`)
    }
    expect(source).not.toContain('const onEscapeClose =')
  })

  it('still closes from the tab button and the close control', () => {
    expect(source).toContain('onClick={handleClose}')
    expect(source).toContain('<ModalCloseButton onClick={handleClose} />')
  })

  it('keeps the rename field cancelling on Escape', () => {
    // A rename is a small, local edit: Escape there means "drop this edit".
    expect(source).toContain("} else if (e.key === 'Escape') {")
    expect(source).toContain('setRenamingSessionId(null)')
  })
})
