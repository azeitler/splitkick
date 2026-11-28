import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** The start skeleton in index.html (#72). */
describe('index.html start skeleton', () => {
  const html = readFileSync(`${process.cwd()}/index.html`, 'utf8')
  const skeletonAt = html.indexOf('<div id="app-skeleton"')
  const rootAt = html.indexOf('<div id="root"></div>')

  it('sits beside #root, so React does not replace it', () => {
    expect(skeletonAt).toBeGreaterThan(-1)
    expect(skeletonAt).toBeLessThan(rootAt)
    expect(html).toContain('<div id="root"></div>')
  })

  it('is a status for screen readers, with the shapes hidden', () => {
    expect(html).toContain('id="app-skeleton" role="status"')
    expect(html).toContain('class="sk-phone" aria-hidden="true"')
    expect(html).toContain('class="sk-desktop" aria-hidden="true"')
    expect(html).toContain('class="sk-spinner" aria-hidden="true"')
  })

  it('has a phone layout at the useIsMobile breakpoint', () => {
    expect(html).toContain('@media (max-width: 767px)')
  })

  it('respects reduced motion', () => {
    expect(html).toContain('@media (prefers-reduced-motion: reduce)')
  })

  it('is removed in the desktop app before it paints', () => {
    expect(html).toMatch(
      /if \(window\.__TAURI_INTERNALS__\)\s*document\.getElementById\('app-skeleton'\)\.remove\(\)/
    )
  })

  // The build's start loader (scripts/web-start-loader.mjs) and App.tsx fill
  // these; before that nothing shows but the spinner.
  it('has a hidden download bar, step and slow hint', () => {
    expect(html).toMatch(/class="sk-progress"\s+role="progressbar"/)
    expect(html).toMatch(/aria-valuemin="0"\s+aria-valuemax="100"/)
    expect(html).toMatch(/<p class="sk-step" hidden><\/p>/)
    expect(html).toMatch(/<p class="sk-hint" hidden>/)
    expect(html).toContain('#app-skeleton [hidden] {')
  })

  it('names no product (the build rewrites only the title)', () => {
    const skeleton = html.slice(skeletonAt, rootAt)
    expect(skeleton).not.toMatch(/Jean|Splitkick/)
  })
})
