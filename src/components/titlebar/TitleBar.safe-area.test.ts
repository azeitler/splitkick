import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const titleBar = read('src/components/titlebar/TitleBar.tsx')
const mainWindow = read('src/components/layout/MainWindow.tsx')
const toolbar = read('src/components/toolbar/WindowToolbar.tsx')
const sidebarHeader = read('src/components/sidebar/SidebarHeader.tsx')
const css = read('src/App.css')

describe('title bar height and safe area', () => {
  it('defines the bar height as one variable that includes the top inset', () => {
    // Was a literal h-8, so under viewport-fit=cover the bar rendered under an
    // iPhone status bar / notch.
    expect(css).toContain(
      '--titlebar-height: calc(2.75rem + var(--safe-area-top))'
    )
    // Desktop: the 52pt unified toolbar. Insets resolve to 0px there.
    expect(css).toMatch(
      /@media \(min-width: 768px\) \{\s*:root \{\s*--titlebar-height: calc\(3\.25rem \+ var\(--safe-area-top\)\);/
    )
  })

  it('keeps the bar and the content offset in step through the variable', () => {
    expect(titleBar).toContain('h-[var(--titlebar-height)]')
    expect(mainWindow).toContain('pt-[var(--titlebar-height)]')
    // Neither side may go back to a literal that the other cannot see.
    expect(titleBar).not.toMatch(/'relative flex h-8 /)
    expect(mainWindow).not.toContain('overflow-hidden pt-8')
  })

  it('pads out the notch and the landscape side insets', () => {
    expect(titleBar).toContain('pt-[var(--safe-area-top)]')
    expect(titleBar).toContain('pl-[var(--safe-area-left)]')
    expect(titleBar).toContain('pr-[var(--safe-area-right)]')
  })
})

describe('the desktop window chrome', () => {
  it('sizes the toolbar and the sidebar header from the same variable', () => {
    // The two sit side by side; the traffic lights are centred in both
    // (trafficLightPosition in tauri.conf.json).
    expect(toolbar).toContain('h-[var(--titlebar-height)]')
    expect(sidebarHeader).toContain('h-[var(--titlebar-height)]')
  })

  it('uses AppKit-sized toolbar buttons with a hover bezel', () => {
    expect(toolbar).toContain(
      "'h-7 w-[30px] rounded-md text-foreground/70 hover:bg-foreground/10 hover:text-foreground [&_svg]:size-4'"
    )
  })
})

describe('mobile web overscroll', () => {
  it('stops the rubber-band and pull-to-refresh outside the native app', () => {
    const nativeBlockIndex = css.indexOf('body.native-app {')
    expect(nativeBlockIndex).toBeGreaterThan(-1)
    const beforeNative = css.slice(0, nativeBlockIndex)
    // Pull-to-refresh competes with the swipe-down command palette, and the
    // rule has to be on `html` to reach the viewport.
    expect(beforeNative).toMatch(
      /html,\s*\n\s*body \{\s*\n\s*overscroll-behavior: none;/
    )
    // 100vw includes the classic scrollbar width.
    expect(css).not.toContain('min-width: 100vw')
  })

  it('still restricts text-selection locking to the native app', () => {
    const nativeBlockIndex = css.indexOf('body.native-app {')
    expect(css.slice(0, nativeBlockIndex)).not.toContain('user-select: none')
    expect(css.slice(nativeBlockIndex)).toContain('user-select: none')
  })
})
