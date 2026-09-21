import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('MainWindow header integration', () => {
  it('offsets each desktop column by the title bar height', () => {
    const source = readFileSync('src/components/layout/MainWindow.tsx', 'utf8')

    expect(source).toContain('<div className="flex flex-1 overflow-hidden">')
    expect(
      source.match(
        /className="h-full overflow-hidden bg-sidebar pt-\[var\(--titlebar-height\)\]"/g
      )
    ).toHaveLength(1)
    expect(source).toContain(
      'className="h-full overflow-hidden bg-sidebar pt-[var(--titlebar-height)] dark:bg-[#0b0b0b]"'
    )
    expect(source).toContain(
      'className="flex min-w-0 flex-1 flex-col overflow-hidden pt-[var(--titlebar-height)]"'
    )
  })
})
