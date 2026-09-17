import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('project instance controls', () => {
  it('places section expansion controls beside each instance label', () => {
    const source = readFileSync('src/components/projects/ProjectTree.tsx', 'utf8')

    expect(source).toContain('data-testid="instance-title-actions"')
    expect(source).toContain('setProjectExpanded(item.id, true)')
    expect(source).toContain('setProjectExpanded(item.id, false)')
  })
})
