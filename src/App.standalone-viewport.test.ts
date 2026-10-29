import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(process.cwd(), 'src/App.css'), 'utf8')

describe('iOS Home Screen app viewport (#63)', () => {
  it('makes the page as tall as the screen in standalone mode', () => {
    // iOS 26 sizes a standalone app with viewport-fit=cover and the
    // black-translucent status bar short by the status bar height while the
    // page is shorter than the screen (WebKit 301108). A page one inset
    // taller gets the full viewport; min() caps it for an opaque status bar.
    expect(css).toMatch(
      /@media \(display-mode: standalone\)\s*\{\s*html\s*\{\s*min-height: min\(\s*100lvh,\s*calc\(100% \+ var\(--safe-area-top\)\)\s*\);?\s*\}\s*\}/
    )
  })
})
