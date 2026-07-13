import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('initial theme bootstrap', () => {
  const source = readFileSync(`${process.cwd()}/index.html`, 'utf8')

  it('paints the initial theme without styling the React root', () => {
    expect(source).toContain("localStorage.getItem('ui-theme')")
    expect(source).toContain('html.dark {')
    expect(source).not.toMatch(/html\.dark\s+body/)
    expect(source).not.toMatch(/html\.dark\s+#root/)
    expect(source).not.toMatch(/body,\s*#root/)
  })
})
