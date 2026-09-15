import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const appCss = readFileSync('src/App.css', 'utf8')

describe('sidebar theme', () => {
  it('uses a darker navigation surface than the main surface in both themes', () => {
    expect(appCss).toContain('--background: oklch(1 0 0)')
    expect(appCss).toContain('--sidebar: oklch(0.97 0 0)')
    expect(appCss).toContain('--background: #101010')
    expect(appCss).toContain('--sidebar: #0a0a0a')
  })
})
