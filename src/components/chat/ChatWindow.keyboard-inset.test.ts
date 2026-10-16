import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const source = read('src/components/chat/ChatWindow.tsx')
const terminalSource = read('src/components/chat/TerminalView.tsx')
const mainWindow = read('src/components/layout/MainWindow.tsx')

describe('ChatWindow soft keyboard', () => {
  it('sizes the shell from the visual viewport, once, in web access', () => {
    expect(mainWindow).toContain('useVisualViewportShell(!isNativeApp())')
    expect(mainWindow).toContain('h-[var(--app-height,100dvh)]')
  })

  it('does not pad the chat column or the terminal by a measured inset', () => {
    // Padding on top of the shell resize lifted the composer twice, and a
    // stale value left a band under it after the keyboard closed.
    expect(source).not.toContain('useVisualViewportBottomInset')
    expect(terminalSource).not.toContain('useVisualViewportBottomInset')
    expect(source).not.toContain('keyboardInset')
  })

  it('drops the home-indicator padding while the keyboard is open', () => {
    expect(source).toContain('useSoftKeyboardOpen()')
    expect(source).toContain('isMobile && !keyboardOpen')
    expect(source).not.toMatch(
      /isMobile\s*\n?\s*\? \{ paddingBottom: 'var\(--safe-area-bottom\)' \}/
    )
  })

  it('re-sticks to the tail when the keyboard opens', () => {
    expect(source).toContain('isAtBottomForKeyboardRef')
    expect(source).toMatch(
      /if \(!keyboardOpen \|\| !isAtBottomForKeyboardRef\.current\) return/
    )
    expect(source).toMatch(/\}, \[keyboardOpen, scrollToBottom\]\)/)
  })
})
