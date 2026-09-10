import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// A sidebar project-row click must land on the canvas itself. With "restore
// last session" on, the canvas reopened the last session of the project, and a
// session already open on the same canvas stayed on top.
describe('ProjectCanvasView project home request', () => {
  const source = readFileSync(
    `${process.cwd()}/src/components/dashboard/ProjectCanvasView.tsx`,
    'utf8'
  )

  it('consumes the request, closes the open session and skips the restore', () => {
    const start = source.indexOf('const projectHomeRequested = useUIStore(')
    expect(start).toBeGreaterThan(-1)
    const effect = source.slice(start, source.indexOf('}, [', start))

    expect(effect).toContain('clearProjectHomeRequest(projectId)')
    expect(effect).toContain('suppressNextRestoreAutoOpenRef.current = true')
    expect(effect).toContain('setSelectedWorktreeModal(null)')
  })

  it('runs before the restore effect, so the suppression is set in time', () => {
    const request = source.indexOf('const projectHomeRequested = useUIStore(')
    const restore = source.indexOf(
      'const suppressRestoreAutoOpen = suppressNextRestoreAutoOpenRef.current'
    )

    expect(request).toBeGreaterThan(-1)
    expect(restore).toBeGreaterThan(request)
  })
})
