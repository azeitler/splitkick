import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  getCanvasHighlight,
  shouldWaitForCanvasRestorePreferences,
} from './ProjectCanvasView'

describe('ProjectCanvasView keyboard navigation', () => {
  it('tracks an empty worktree as the highlighted keyboard row', () => {
    expect(
      getCanvasHighlight({
        worktreeId: 'empty-worktree',
        card: null,
      })
    ).toEqual({
      worktreeId: 'empty-worktree',
      sessionId: undefined,
    })
  })
})

describe('ProjectCanvasView session restoration', () => {
  const source = readFileSync(join(__dirname, 'ProjectCanvasView.tsx'), 'utf-8')

  it('waits for preferences before deciding whether to reopen a session', () => {
    expect(shouldWaitForCanvasRestorePreferences(undefined)).toBe(true)
    expect(
      shouldWaitForCanvasRestorePreferences({ restore_last_session: true })
    ).toBe(false)
  })

  // The decision is one-shot: it commits `setSelectedIndex`, and every later
  // run returns at the `selectedIndex !== null` guard. Deciding before
  // preferences load reads `restore_last_session` as false and the modal never
  // opens, so the wait has to come first.
  it('gates the restore effect on preferences before the one-shot guard', () => {
    const gate = source.indexOf(
      'if (shouldWaitForCanvasRestorePreferences(preferences)) return'
    )
    const oneShotGuard = source.indexOf(
      'if (selectedIndex !== null || selectedWorktreeModal) return'
    )

    expect(gate).toBeGreaterThan(-1)
    expect(oneShotGuard).toBeGreaterThan(-1)
    expect(gate).toBeLessThan(oneShotGuard)
  })

  it('reopens the last active worktree session, not only the last opened one', () => {
    const restoreEffect = source.slice(
      source.indexOf(
        'if (shouldWaitForCanvasRestorePreferences(preferences)) return'
      ),
      source.indexOf('// Handle clicking on a worktree row')
    )
    const lastActiveBranch = restoreEffect.slice(
      restoreEffect.indexOf('if (targetIndex === -1 && lastActiveWorktreeId)'),
      restoreEffect.indexOf("// Fallback: check any worktree's persisted")
    )

    expect(lastActiveBranch).toContain('preferences?.restore_last_session')
    expect(lastActiveBranch).toContain('shouldAutoOpenModal = true')
  })
})
