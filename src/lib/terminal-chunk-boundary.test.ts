/**
 * Structure guard: the first screen must not load the terminal code.
 *
 * `terminal-instances` pulls in xterm and ghostty-web (the `terminal` chunk,
 * about 266 KB gzipped). One static import from a module on the first-screen
 * path makes the entry preload that chunk on every first visit, about 5 s on
 * a slow link. Those modules use `terminal-instances-lazy`, `terminal-prefs`
 * and `lazy()` components instead.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, 'utf8')

const FIRST_SCREEN_MODULES = [
  'src/services/chat.ts',
  'src/services/projects.ts',
  'src/hooks/useMainWindowEventListeners.ts',
  'src/hooks/useTerminalThemeSync.ts',
  'src/components/chat/ChatWindow.tsx',
  'src/components/chat/SessionChatModal.tsx',
]

describe('terminal chunk boundary', () => {
  it.each(FIRST_SCREEN_MODULES)(
    '%s imports no terminal code statically',
    path => {
      const source = read(path)
      expect(source).not.toMatch(/from '@\/lib\/terminal-instances'/)
      expect(source).not.toMatch(
        /^import \{[^}]*\} from '\.\/(TerminalPanel|FullScreenTerminalSurface|ModalTerminalDrawer|TerminalView)'/m
      )
      expect(source).not.toMatch(/from '@xterm\/|from 'ghostty-web'/)
    }
  )

  // Without its own chunk, Vite's dynamic-import helper lands in `terminal`
  // (ghostty-web uses a dynamic import), and every lazy import preloads it.
  it('keeps the dynamic-import helper out of the terminal chunk', () => {
    expect(read('vite.config.ts')).toMatch(
      /id\.includes\('vite\/preload-helper'\)\) return 'preload-helper'/
    )
  })
})
