import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// MainWindow and TitleBar are too heavy to mount here; like the other tests of
// these two files, this pins the wiring in the source. `useIsHomeActive` itself
// is covered by its own behavioural test.
const read = (path: string) => readFileSync(`${process.cwd()}/${path}`, 'utf8')

describe('file browser on Home', () => {
  it('is not rendered by MainWindow while Home is showing', () => {
    const source = read('src/components/layout/MainWindow.tsx')
    expect(source).toContain('useIsHomeActive()')
    expect(source).toMatch(
      /fileBrowserVisible =\s*useUIStore\(state => state\.fileBrowserVisible\) && !isHomeActive/
    )
  })

  it('has a disabled, unpressed toggle in the title bar on Home', () => {
    const source = read('src/components/titlebar/TitleBar.tsx')
    expect(source).toContain('disabled={isHomeActive}')
    expect(source).toMatch(
      /fileBrowserVisible =\s*useUIStore\(state => state\.fileBrowserVisible\) && !isHomeActive/
    )
  })
})
