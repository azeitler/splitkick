import { describe, expect, it } from 'vitest'
import { shouldHideFloatingDock } from './floating-dock-visibility'

describe('shouldHideFloatingDock', () => {
  it('hides the dock on every viewport while zen mode is active', () => {
    expect(shouldHideFloatingDock(true, true)).toBe(true)
    expect(shouldHideFloatingDock(true, false)).toBe(false)
    expect(shouldHideFloatingDock(false, true)).toBe(true)
    expect(shouldHideFloatingDock(false, false)).toBe(false)
  })

  it('gives the phone tab root corner to the search button', () => {
    expect(shouldHideFloatingDock(true, false, true)).toBe(true)
  })

  it('keeps the dock inside a project or session on a phone', () => {
    expect(shouldHideFloatingDock(true, false, false)).toBe(false)
  })

  it('keeps the desktop dock at the root', () => {
    // Desktop Home has no tab bar competing for the corner.
    expect(shouldHideFloatingDock(false, false, true)).toBe(false)
  })
})
