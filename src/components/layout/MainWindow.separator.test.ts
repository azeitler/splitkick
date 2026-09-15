import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('MainWindow sidebar separators', () => {
  it('uses the same subdued border color as the project sidebar divider', () => {
    const source = readFileSync('src/components/layout/MainWindow.tsx', 'utf8')

    expect(
      source.match(/className="relative h-full w-px bg-border\/40"/g)
    ).toHaveLength(2)
    expect(source).not.toContain(
      'className="relative h-full w-px bg-border"'
    )
  })
})
