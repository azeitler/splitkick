import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Dialog, DialogContent, DialogTitle } from './dialog'
import { Sheet, SheetContent, SheetTitle } from './sheet'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

/**
 * Dialogs, sheets and menus share one z-index tier. Radix portals append in
 * open order, so the layer opened last is on top — no per-call z overrides.
 */
describe('overlay layering', () => {
  it('puts dialog and sheet overlays and content on the same tier', () => {
    render(
      <>
        <Sheet open>
          <SheetContent>
            <SheetTitle>Sheet</SheetTitle>
          </SheetContent>
        </Sheet>
        <Dialog open>
          <DialogContent>
            <DialogTitle>Dialog</DialogTitle>
          </DialogContent>
        </Dialog>
      </>
    )

    for (const slot of [
      'sheet-overlay',
      'sheet-content',
      'dialog-overlay',
      'dialog-content',
    ]) {
      const el = document.querySelector(`[data-slot="${slot}"]`)
      expect(el?.className, slot).toContain('z-[80]')
    }
  })

  it('has no z-index override left on the file viewer dialog', () => {
    const source = read('src/components/chat/FileContentModal.tsx')
    expect(source).not.toContain('z-[90]')
  })
})

describe('sheet modal mode', () => {
  it('renders a backdrop and locks the page for a modal sheet', () => {
    render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>Modal</SheetTitle>
        </SheetContent>
      </Sheet>
    )
    expect(document.querySelector('[data-slot="sheet-overlay"]')).not.toBeNull()
    expect(document.body.style.pointerEvents).toBe('none')
  })

  it('renders no backdrop and does not lock the page for modal={false}', () => {
    render(
      <>
        <button type="button">Page button</button>
        <Sheet open modal={false}>
          <SheetContent>
            <SheetTitle>Drawer</SheetTitle>
          </SheetContent>
        </Sheet>
      </>
    )
    expect(document.querySelector('[data-slot="sheet-overlay"]')).toBeNull()
    expect(document.body.style.pointerEvents).not.toBe('none')
    // A modal Radix dialog hides the rest of the page from assistive tech.
    expect(
      screen.getByRole('button', { name: 'Page button' })
    ).toBeInTheDocument()
  })

  it('passes modal={false} on the root of the floating drawers', () => {
    for (const p of [
      'src/components/chat/ModalTerminalDrawer.tsx',
      'src/components/browser/ModalBrowserDrawer.tsx',
    ]) {
      const source = read(p)
      expect(source, p).toMatch(
        /<Sheet\s[\s\S]*?modal=\{false\}\s*>\s*<SheetContent/
      )
    }
  })
})

describe('menus that open sheets or dialogs', () => {
  // A modal DropdownMenu locks body pointer-events; a sheet opened while the
  // menu animates out restores that lock on close and freezes the UI.
  it.each([
    'src/components/chat/toolbar/MobileSettingsMenu.tsx',
    'src/components/chat/toolbar/MobileToolbarMenu.tsx',
    'src/components/chat/toolbar/DockBurgerButton.tsx',
  ])('%s uses a non-modal DropdownMenu', p => {
    expect(read(p)).toMatch(/<DropdownMenu\s[^>]*modal=\{false\}/)
  })
})
