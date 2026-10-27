import { useRef } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { House } from 'lucide-react'
import { SidebarStickySectionHeader } from './SidebarStickySectionHeader'
import { useSidebarStickyStack } from './useSidebarStickyStack'
import {
  STACK_BOTTOM_ATTR,
  STUCK_ATTR,
  keepStuckRowInSlot,
} from './sidebar-sticky'

/** Give an element a fixed layout box: jsdom does no layout. */
function placeAt(el: Element, top: number, height = 32, left = 0) {
  el.getBoundingClientRect = () =>
    ({ top, bottom: top + height, left, right: 300, height }) as DOMRect
}

function scroller(scrollTop: number) {
  const el = document.querySelector<HTMLElement>('[data-sidebar-sticky-scroll]')
  if (!el) throw new Error('no scroller')
  placeAt(el, 100, 600)
  Object.defineProperty(el, 'scrollTop', { value: scrollTop, writable: true })
  el.scrollTo = vi.fn() as unknown as typeof el.scrollTo
  return el
}

describe('SidebarStickySectionHeader', () => {
  function renderHeader(onToggle: () => void) {
    render(
      <div data-sidebar-sticky-scroll="">
        <SidebarStickySectionHeader
          top="32px"
          icon={<House />}
          label="Folders"
          count={2}
          expanded
          onToggle={onToggle}
          testId="folders-toggle"
        />
      </div>
    )
    const toggle = screen.getByTestId('folders-toggle')
    const header = toggle.closest<HTMLElement>('[data-sidebar-sticky]')
    const anchor = header?.previousElementSibling
    if (!header || !anchor) throw new Error('no header')
    return { toggle, header, anchor }
  }

  it('toggles the section while it sits at its own position', async () => {
    const onToggle = vi.fn()
    const { toggle, header, anchor } = renderHeader(onToggle)
    const sc = scroller(0)
    placeAt(anchor, 400, 0)
    placeAt(header, 400)

    await userEvent.click(toggle)

    expect(onToggle).toHaveBeenCalledOnce()
    expect(sc.scrollTo).not.toHaveBeenCalled()
  })

  it('jumps to its section while it is stuck, without toggling', async () => {
    const onToggle = vi.fn()
    const { toggle, header, anchor } = renderHeader(onToggle)
    const sc = scroller(500)
    // Natural position scrolled 300 px above the scroller; stuck in slot 32.
    placeAt(anchor, -200, 0)
    placeAt(header, 132)

    await userEvent.click(toggle)

    expect(onToggle).not.toHaveBeenCalled()
    // 500 + (-200 - 100) - 32: the anchor lands in the header's slot.
    expect(sc.scrollTo).toHaveBeenCalledWith(
      expect.objectContaining({ top: 168 })
    )
  })
})

describe('useSidebarStickyStack', () => {
  let rafQueue: FrameRequestCallback[] = []

  beforeEach(() => {
    rafQueue = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafQueue.push(cb)
      return rafQueue.length
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })
  afterEach(() => vi.unstubAllGlobals())

  const flush = () => {
    const queue = rafQueue
    rafQueue = []
    queue.forEach(cb => cb(0))
  }

  function Stack() {
    const ref = useRef<HTMLDivElement>(null)
    useSidebarStickyStack(ref)
    return (
      <div ref={ref} data-sidebar-sticky-scroll="">
        <div
          data-testid="header"
          data-sidebar-sticky=""
          style={{ top: '0px' }}
        />
        <div
          data-testid="project"
          data-sidebar-sticky=""
          style={{ top: '32px' }}
        />
        <div
          data-testid="next"
          data-sidebar-sticky=""
          style={{ top: '32px' }}
        />
      </div>
    )
  }

  it('marks the stuck rows and puts the hairline under the lowest', () => {
    render(<Stack />)
    const sc = scroller(300)
    placeAt(screen.getByTestId('header'), 100)
    placeAt(screen.getByTestId('project'), 132, 32, 24)
    // Still on its way up: not stuck.
    placeAt(screen.getByTestId('next'), 400)

    sc.dispatchEvent(new Event('scroll'))
    flush()

    expect(screen.getByTestId('header')).toHaveAttribute(STUCK_ATTR)
    expect(screen.getByTestId('project')).toHaveAttribute(STUCK_ATTR)
    expect(screen.getByTestId('next')).not.toHaveAttribute(STUCK_ATTR)
    expect(screen.getByTestId('project')).toHaveAttribute(STACK_BOTTOM_ATTR)
    expect(screen.getByTestId('header')).not.toHaveAttribute(STACK_BOTTOM_ATTR)
    expect(screen.getByTestId('project').style.getPropertyValue('--sb-x')).toBe(
      '24px'
    )
  })

  it('clears the marks at the top of the list', () => {
    render(<Stack />)
    const sc = scroller(300)
    placeAt(screen.getByTestId('header'), 100)
    placeAt(screen.getByTestId('project'), 132)
    placeAt(screen.getByTestId('next'), 400)
    sc.dispatchEvent(new Event('scroll'))
    flush()

    sc.scrollTop = 0
    sc.dispatchEvent(new Event('scroll'))
    flush()

    expect(screen.getByTestId('header')).not.toHaveAttribute(STUCK_ATTR)
    expect(screen.getByTestId('project')).not.toHaveAttribute(STACK_BOTTOM_ATTR)
  })
})

describe('keepStuckRowInSlot', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('scrolls a collapsed stuck row back into its slot', () => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 1
    })
    render(
      <div data-sidebar-sticky-scroll="">
        <div data-testid="block">
          <div
            data-testid="row"
            data-sidebar-sticky=""
            style={{ top: '64px' }}
          />
        </div>
      </div>
    )
    const sc = scroller(800)
    const row = screen.getByTestId('row')
    row.setAttribute(STUCK_ATTR, '')
    // After the collapse the project's block starts 500 px above the scroller.
    placeAt(screen.getByTestId('block'), -400, 32)

    keepStuckRowInSlot(row)

    // 800 + (-400 - 100) - 64
    expect(sc.scrollTo).toHaveBeenCalledWith({ top: 236, behavior: 'auto' })
  })

  it('does nothing for a row that is not stuck', () => {
    const raf = vi.fn()
    vi.stubGlobal('requestAnimationFrame', raf)
    render(<div data-testid="row" data-sidebar-sticky="" />)

    keepStuckRowInSlot(screen.getByTestId('row'))

    expect(raf).not.toHaveBeenCalled()
  })
})
