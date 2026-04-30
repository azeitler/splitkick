import type { AppPreferences } from '@/types/preferences'

const LIGHT_BG = '#fafafa'
const DARK_BG = '#101010'
const LIGHT_FG = '#101010'
const DARK_FG = '#fafafa'
const LIGHT_SEL = '#e5e5e5'
const DARK_SEL = '#242424'

export interface ResolvedTerminalTheme {
  background: string
  foreground: string
  cursor: string
  selectionBackground: string
}

export function isValidHex(value: string | null | undefined): value is string {
  if (typeof value !== 'string') return false
  return /^#[0-9a-f]{6}$/i.test(value.trim())
}

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m || !m[1]) return 0
  const n = parseInt(m[1], 16)
  const r = ((n >> 16) & 0xff) / 255
  const g = ((n >> 8) & 0xff) / 255
  const b = (n & 0xff) / 255
  const lin = (x: number) =>
    x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

export function pickReadableFg(bgHex: string): string {
  return luminance(bgHex) > 0.5 ? LIGHT_FG : DARK_FG
}

export function resolveTerminalTheme(
  prefs: Pick<
    AppPreferences,
    'terminal_background' | 'terminal_background_custom'
  >,
  fallbackFromCss: () => ResolvedTerminalTheme
): ResolvedTerminalTheme {
  switch (prefs.terminal_background) {
    case 'light':
      return {
        background: LIGHT_BG,
        foreground: LIGHT_FG,
        cursor: LIGHT_FG,
        selectionBackground: LIGHT_SEL,
      }
    case 'dark':
      return {
        background: DARK_BG,
        foreground: DARK_FG,
        cursor: DARK_FG,
        selectionBackground: DARK_SEL,
      }
    case 'custom': {
      const bg = isValidHex(prefs.terminal_background_custom)
        ? prefs.terminal_background_custom
        : DARK_BG
      const fg = pickReadableFg(bg)
      const sel = luminance(bg) > 0.5 ? LIGHT_SEL : DARK_SEL
      return {
        background: bg,
        foreground: fg,
        cursor: fg,
        selectionBackground: sel,
      }
    }
    case 'auto':
    default:
      return fallbackFromCss()
  }
}
