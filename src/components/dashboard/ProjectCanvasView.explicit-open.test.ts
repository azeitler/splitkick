import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// navigateToSession into a project the canvas has not shown yet (Start
// session from agent, #79): the auto-open effect opened the new session, and
// the restore effect in the same pass reopened the worktree's first session
// over it, because its session list predated the new session.
describe('ProjectCanvasView explicit session open', () => {
  const source = readFileSync(
    `${process.cwd()}/src/components/dashboard/ProjectCanvasView.tsx`,
    'utf8'
  )

  it('suppresses the restore when it opens a named session', () => {
    const start = source.indexOf('if (targetSessionId) {')
    expect(start).toBeGreaterThan(-1)
    const branch = source.slice(start, source.indexOf('break', start))
    expect(branch).toContain('suppressNextRestoreAutoOpenRef.current = true')
    expect(
      branch.indexOf('suppressNextRestoreAutoOpenRef.current = true')
    ).toBeLessThan(branch.indexOf('openWorktreeModal(worktreeId'))
  })

  it('runs before the restore effect, so the suppression is set in time', () => {
    const explicitOpen = source.indexOf('if (targetSessionId) {')
    const restore = source.indexOf(
      'const suppressRestoreAutoOpen = suppressNextRestoreAutoOpenRef.current'
    )
    expect(explicitOpen).toBeGreaterThan(-1)
    expect(restore).toBeGreaterThan(explicitOpen)
  })
})
