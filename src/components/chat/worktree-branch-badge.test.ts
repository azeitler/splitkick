import { describe, expect, it } from 'vitest'
import { getStackedBaseBranch } from './worktree-branch-badge'

describe('getStackedBaseBranch', () => {
  it('hides the badge when an existing branch is opened directly', () => {
    expect(
      getStackedBaseBranch(
        'v5-parallel-inertia-react',
        'v5-parallel-inertia-react',
        'main'
      )
    ).toBeNull()
  })

  it('hides the default branch badge', () => {
    expect(getStackedBaseBranch('main', 'feature', 'main')).toBeNull()
  })

  it('returns a non-default source branch for a derived worktree', () => {
    expect(
      getStackedBaseBranch('feature-parent', 'feature-child', 'main')
    ).toBe('feature-parent')
  })
})
