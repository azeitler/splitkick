/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@/test/test-utils'
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'

if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture ??= vi.fn(() => false)
  Element.prototype.setPointerCapture ??= vi.fn()
}

const onSelect = vi.fn()
const onCheckedChange = vi.fn()

beforeEach(() => {
  onSelect.mockClear()
  onCheckedChange.mockClear()
})

function renderMenu(children?: React.ReactNode) {
  return render(
    <ContextMenu>
      <ContextMenuTrigger>
        <span>target</span>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {children ?? (
          <ContextMenuItem onSelect={onSelect}>Delete</ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** Right-click the trigger. The button is still held down at this point. */
const openMenu = () => fireEvent.contextMenu(screen.getByText('target'))

/** The user lets go of the right button somewhere outside the menu. */
const releaseOutside = () => fireEvent.pointerUp(document.body)

describe('ContextMenu — the opening right-click must not select', () => {
  it('ignores the release that ends the opening right-click', async () => {
    renderMenu()
    openMenu()

    // Radix shifts the menu up over the cursor when there is no room below, so
    // the release lands on an item. It must not run.
    fireEvent.pointerUp(await screen.findByRole('menuitem', { name: 'Delete' }))

    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
  })

  it('ignores that release on a checkbox item too', async () => {
    renderMenu(
      <ContextMenuCheckboxItem
        checked={false}
        onCheckedChange={onCheckedChange}
      >
        Bug
      </ContextMenuCheckboxItem>
    )
    openMenu()

    fireEvent.pointerUp(
      await screen.findByRole('menuitemcheckbox', { name: 'Bug' })
    )

    expect(onCheckedChange).not.toHaveBeenCalled()
  })

  it('still selects on a deliberate click', async () => {
    renderMenu()
    openMenu()

    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))

    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('allows press-drag-release once the opening release is done', async () => {
    renderMenu()
    openMenu()
    releaseOutside()

    fireEvent.pointerUp(await screen.findByRole('menuitem', { name: 'Delete' }))

    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('re-arms the gate for a second right-click', async () => {
    renderMenu()
    openMenu()
    releaseOutside()
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }))
    onSelect.mockClear()

    openMenu()
    fireEvent.pointerUp(await screen.findByRole('menuitem', { name: 'Delete' }))

    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('ContextMenuContent — tall menus', () => {
  it('scrolls instead of clipping the items past the available height', async () => {
    renderMenu()
    openMenu()

    const content = await screen.findByRole('menu')
    expect(content).toHaveClass('overflow-y-auto')
    expect(content).not.toHaveClass('overflow-hidden')
  })
})
