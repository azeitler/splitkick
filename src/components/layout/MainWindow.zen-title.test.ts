import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Zen mode and the remote prefix are covered behaviourally in
// src/lib/window-title.test.ts; this guards the wiring at the call site.
describe('MainWindow window title', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/components/layout/MainWindow.tsx'),
    'utf8'
  )

  it('builds the title from the shared formatter, never from zen mode', () => {
    expect(source).toContain('formatWindowTitle({')
    expect(source).not.toContain('zenMode ? ')
  })

  it('passes the active remote connection name as the prefix', () => {
    expect(source).toContain('useActiveRemoteConnection()')
    expect(source).toContain('remoteName: remoteConnection?.name')
  })
})
