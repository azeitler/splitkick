import { describe, it, expect } from 'vitest'
import {
  isValidHex,
  pickReadableFg,
  resolveTerminalTheme,
} from './terminal-theme'

const fallback = () => ({
  background: '#abcdef',
  foreground: '#fedcba',
  cursor: '#fedcba',
  selectionBackground: '#123456',
})

describe('isValidHex', () => {
  it.each([
    ['#abcdef', true],
    ['#ABCDEF', true],
    ['#000000', true],
    ['#fff', false],
    ['abcdef', false],
    ['#xyzxyz', false],
    ['', false],
    [null, false],
    [undefined, false],
  ])('returns %s for %s', (input, expected) => {
    expect(isValidHex(input as string | null | undefined)).toBe(expected)
  })
})

describe('pickReadableFg', () => {
  it('returns dark text on a light background', () => {
    expect(pickReadableFg('#ffffff')).toBe('#101010')
    expect(pickReadableFg('#fafafa')).toBe('#101010')
  })

  it('returns light text on a dark background', () => {
    expect(pickReadableFg('#000000')).toBe('#fafafa')
    expect(pickReadableFg('#101010')).toBe('#fafafa')
  })
})

describe('resolveTerminalTheme', () => {
  it('uses the fallback when mode is auto', () => {
    const theme = resolveTerminalTheme(
      { terminal_background: 'auto', terminal_background_custom: null },
      fallback
    )
    expect(theme).toEqual(fallback())
  })

  it('returns a light preset for mode=light', () => {
    const theme = resolveTerminalTheme(
      { terminal_background: 'light', terminal_background_custom: null },
      fallback
    )
    expect(theme.background).toBe('#fafafa')
    expect(theme.foreground).toBe('#101010')
    expect(theme.cursor).toBe('#101010')
  })

  it('returns a dark preset for mode=dark', () => {
    const theme = resolveTerminalTheme(
      { terminal_background: 'dark', terminal_background_custom: null },
      fallback
    )
    expect(theme.background).toBe('#101010')
    expect(theme.foreground).toBe('#fafafa')
    expect(theme.cursor).toBe('#fafafa')
  })

  it('uses a valid custom hex with luminance-derived foreground', () => {
    const theme = resolveTerminalTheme(
      {
        terminal_background: 'custom',
        terminal_background_custom: '#ffffff',
      },
      fallback
    )
    expect(theme.background).toBe('#ffffff')
    expect(theme.foreground).toBe('#101010')
  })

  it('falls back to the dark preset when custom hex is invalid', () => {
    const theme = resolveTerminalTheme(
      {
        terminal_background: 'custom',
        terminal_background_custom: 'not-a-color',
      },
      fallback
    )
    expect(theme.background).toBe('#101010')
    expect(theme.foreground).toBe('#fafafa')
  })
})
