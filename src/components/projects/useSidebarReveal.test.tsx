import { useRef } from 'react'
import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSidebarReveal } from './useSidebarReveal'
import { useUIStore } from '@/store/ui-store'

function Tree({ rowId }: { rowId: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useSidebarReveal(ref)
  return (
    <div ref={ref}>
      <div data-sidebar-row-id={rowId}>row</div>
    </div>
  )
}

describe('useSidebarReveal', () => {
  beforeEach(() => {
    useUIStore.setState({ pendingSidebarRevealId: null })
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('scrolls the queued row into view and clears the request', async () => {
    render(<Tree rowId="session:s-1" />)
    useUIStore.getState().markSidebarReveal('session:s-1')

    await waitFor(() => {
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith(
        expect.objectContaining({ block: 'nearest' })
      )
    })
    await waitFor(() => {
      expect(useUIStore.getState().pendingSidebarRevealId).toBeNull()
    })
  })

  // A row that never appears must not scroll anything, and the request has to
  // be dropped rather than left waiting for a row that will never mount.
  it('leaves other rows alone and gives up on its own', async () => {
    render(<Tree rowId="session:s-1" />)
    useUIStore.getState().markSidebarReveal('session:s-2')

    await new Promise(resolve => setTimeout(resolve, 50))
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()

    await waitFor(
      () => {
        expect(useUIStore.getState().pendingSidebarRevealId).toBeNull()
      },
      { timeout: 3000 }
    )
  })

  // The user may scroll away right after the jump; a second scroll would fight
  // them, so the request is consumed once.
  it('does not scroll again once the request is consumed', async () => {
    render(<Tree rowId="session:s-1" />)
    useUIStore.getState().markSidebarReveal('session:s-1')

    await waitFor(() => {
      expect(useUIStore.getState().pendingSidebarRevealId).toBeNull()
    })
    const calls = vi.mocked(Element.prototype.scrollIntoView).mock.calls.length

    await new Promise(resolve => setTimeout(resolve, 50))

    expect(vi.mocked(Element.prototype.scrollIntoView).mock.calls).toHaveLength(
      calls
    )
  })

  // Rows above it may still load; scrolling at once would aim at a stale place.
  it('waits until the row stops moving before it scrolls', async () => {
    let top = 500
    const spy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        const y = this.dataset.sidebarRowId ? top : 0
        return { top: y, bottom: y + 20 } as DOMRect
      })
    try {
      render(<Tree rowId="session:s-1" />)
      useUIStore.getState().markSidebarReveal('session:s-1')

      await new Promise(resolve => setTimeout(resolve, 100))
      top = 532 // a 32px group loaded above the row
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()

      await waitFor(() => {
        expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
      })
    } finally {
      spy.mockRestore()
    }
  })
})
