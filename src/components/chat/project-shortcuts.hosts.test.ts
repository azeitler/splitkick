import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// #41: the sidebar and the canvas feed the project's top section from the
// same helper, with the project's pins and its stars.
describe.each([
  'src/components/projects/WorktreeList.tsx',
  'src/components/dashboard/ProjectCanvasView.tsx',
])('%s project top section', file => {
  const source = readFileSync(`${process.cwd()}/${file}`, 'utf8')

  it('resolves pins and stars through resolveProjectShortcutRows', () => {
    expect(source).toContain('resolveProjectShortcutRows(')
    expect(source).not.toContain('resolvePinnedSessionRows(')
  })

  it('reads the starred sessions from the projects store', () => {
    expect(source).toContain('state => state.starredSessions')
  })
})
