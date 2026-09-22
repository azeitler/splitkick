import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

/**
 * The phone layout's wiring into components that are too heavy to render in a
 * unit test (the session modal and the 4000-line canvas). The behaviour of the
 * shell itself is covered by the render tests beside this file.
 */
describe('the session pushes on a phone', () => {
  const modal = read('src/components/chat/SessionChatModal.tsx')

  it('slides in from the right, only on a phone', () => {
    expect(modal).toMatch(
      /isMobile &&\s*\n\s*'motion-safe:animate-in motion-safe:slide-in-from-right/
    )
  })

  it('takes its own touches inside a click-through project layer', () => {
    // A session opened straight from a tab sits in a pointer-events-none layer.
    expect(modal).toContain("'pointer-events-auto absolute inset-0 z-10")
  })

  it('has a back chevron on a phone and the close X on the desktop', () => {
    expect(modal).toMatch(
      /\{isMobile && \(\s*<Button[\s\S]{0,300}aria-label="Back"/
    )
    expect(modal).toContain('data-testid="session-modal-back"')
    expect(modal).toContain(
      '{!isMobile && <ModalCloseButton onClick={handleClose} />}'
    )
  })
})

describe('the canvas as the project modal', () => {
  const canvas = read('src/components/dashboard/ProjectCanvasView.tsx')

  it('hides its content when a session was opened straight from a tab', () => {
    expect(canvas).toContain("mobilePresentation === 'push' && 'invisible'")
  })

  it('renders a close control only when the phone layer asks for one', () => {
    expect(canvas).toMatch(/\{onDismiss && \(\s*<Button/)
    expect(canvas).toContain('aria-label="Close project"')
  })
})

describe('stacking on a phone', () => {
  const z = (source: string, marker: string): number => {
    const index = source.indexOf(marker)
    expect(index, marker).toBeGreaterThan(-1)
    const match = source.slice(index).match(/\bz-(?:\[(\d+)\]|(\d+))/)
    return Number(match?.[1] ?? match?.[2])
  }

  it('keeps the corner dock above the project modal', () => {
    // The dock was reachable over the canvas before the canvas became a
    // modal; a layer above it hid the corner menu inside every project.
    const dock = z(
      read('src/components/ui/floating-dock.tsx'),
      'absolute right-4 z-'
    )
    const layer = z(
      read('src/components/mobile/MobileProjectLayer.tsx'),
      "'absolute inset-0 z-"
    )
    const tabBar = z(
      read('src/components/mobile/MobileTabBar.tsx'),
      'absolute inset-x-0 bottom-0 z-'
    )

    expect(tabBar).toBeLessThan(layer)
    expect(layer).toBeLessThan(dock)
  })
})

describe('a phone has no title bar', () => {
  const mainWindow = read('src/components/layout/MainWindow.tsx')

  it('renders it only in zen mode, where it holds the only exit', () => {
    expect(mainWindow).toContain('const showTitleBar = !isMobile || zenMode')
    expect(mainWindow).toMatch(/\{showTitleBar && \(\s*<TitleBar/)
  })

  it('still clears the status bar and the notch without it', () => {
    expect(mainWindow).toMatch(
      /showTitleBar\s*\?\s*'pt-\[var\(--titlebar-height\)\]'\s*:\s*'pt-\[var\(--safe-area-top\)\]'/
    )
  })

  it('names the project in the session header instead', () => {
    const modal = read('src/components/chat/SessionChatModal.tsx')
    expect(modal).toMatch(
      /\{project && isMobile && \([\s\S]{0,300}session-modal-project-name/
    )
  })
})

describe('the drawer is retired on a phone', () => {
  it('is gone, with its sidebar swipe', () => {
    expect(existsSync('src/components/layout/MobileLeftSidebar.tsx')).toBe(
      false
    )
    const mainWindow = read('src/components/layout/MainWindow.tsx')
    expect(mainWindow).not.toContain('MobileLeftSidebar')
    expect(mainWindow).not.toContain('swipeOpenSidebar')
  })

  it('renders the phone title bar before any desktop control', () => {
    // The phone branch returns early, so no desktop button can leak into it.
    const titleBar = read('src/components/titlebar/TitleBar.tsx')
    const phone = titleBar.indexOf('if (isMobile) {')
    expect(phone).toBeGreaterThan(-1)
    expect(phone).toBeLessThan(titleBar.indexOf('onClick={toggleLeftSidebar}'))
  })

  it('keeps the desktop in-flow sidebar', () => {
    // The redesign is below the breakpoint only.
    expect(read('src/components/layout/MainWindow.tsx')).toContain(
      '{!isMobile && leftSidebarVisible && isInitialized && ('
    )
  })
})
