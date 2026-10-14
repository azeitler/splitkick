import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// ProjectCanvasView and SessionChatModal are too heavy to mount here; like the
// other tests of these files, this pins the wiring in the source. The slot
// behaviour itself is covered by toolbar-slots.test.tsx, the live result by
// e2e/tests/window-toolbar.spec.ts.
const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, 'utf8')

describe('views fill the window toolbar on desktop', () => {
  it('moves the project canvas header into the toolbar', () => {
    const canvas = read('src/components/dashboard/ProjectCanvasView.tsx')
    expect(canvas).toContain('const hasToolbar = useHasWindowToolbar()')
    expect(canvas).toMatch(/<ToolbarContent\s+title=\{project\.name\}/)
    expect(canvas).toContain('chips={projectBadges}')
    expect(canvas).toContain('<ToolbarFilterSearch')
    // The canvas filter shortcut ("/") focuses the input in the toolbar.
    expect(canvas).toMatch(/<ToolbarFilterSearch\s+ref=\{searchInputRef\}/)
  })

  it('moves the session header into the toolbar and keeps the tabs below', () => {
    const modal = read('src/components/chat/SessionChatModal.tsx')
    expect(modal).toContain('const hasToolbar = useHasWindowToolbar()')
    expect(modal).toMatch(/<ToolbarContent\s+title=\{sessionTitle\}/)
    expect(modal).toContain('chips={sessionChips}')
    expect(modal).toContain('<ModalCloseButton onClick={handleClose} />')
    // Own header only without a toolbar (phone).
    expect(modal).toContain('{!zenMode && !hasToolbar && (')
    expect(modal).toContain('{/* Session tabs')
  })
})
