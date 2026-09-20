import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const source = read('src/components/chat/ChatWindow.tsx')
const terminalSource = read('src/components/chat/TerminalView.tsx')

describe('ChatWindow soft-keyboard inset', () => {
  it('measures the chat column with the shared visual-viewport hook', () => {
    expect(source).toContain(
      "import { useVisualViewportBottomInset } from '@/hooks/useVisualViewportBottomInset'"
    )
    expect(source).toMatch(
      /useVisualViewportBottomInset\(\s*chatColumnRef,\s*!isNativeApp\(\) \|\| isMobile\s*\)/
    )
  })

  it('enables the hook on the same surfaces as the terminal', () => {
    // Both bottom-anchored surfaces must agree, or one compensates while the
    // other does not.
    expect(terminalSource).toContain('!isNativeApp() || isMobile')
  })

  it('pads the chat column rather than the shell root or the form', () => {
    // The column is h-full inside a fixed-height chain, so padding it cannot
    // move its own bottom edge — no measure/pad feedback loop. It is also a
    // sibling of the terminal panel, so the terminal is never padded twice.
    expect(source).toMatch(
      /ref=\{chatColumnRef\}[\s\S]{0,400}paddingBottom:\s*\n?\s*keyboardInset > 0 \? keyboardInset : undefined/
    )
    const mainWindow = read('src/components/layout/MainWindow.tsx')
    expect(mainWindow).not.toContain('keyboardInset')
  })

  it('drops the home-indicator padding while the keyboard is open', () => {
    expect(source).toContain('isMobile && keyboardInset === 0')
    expect(source).not.toMatch(
      /isMobile\s*\n?\s*\? \{ paddingBottom: 'var\(--safe-area-bottom\)' \}/
    )
  })

  it('re-sticks to the tail when the message area shrinks', () => {
    expect(source).toContain('isAtBottomForKeyboardRef')
    expect(source).toMatch(
      /if \(keyboardInset <= 0 \|\| !isAtBottomForKeyboardRef\.current\) return/
    )
    // Read through a ref so the effect does not re-run on every bottom flip.
    expect(source).toMatch(/\}, \[keyboardInset, scrollToBottom\]\)/)
  })
})
