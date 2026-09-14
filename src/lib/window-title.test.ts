import { describe, expect, it } from 'vitest'
import { formatWindowTitle } from './window-title'

describe('formatWindowTitle', () => {
  const worktree = {
    productName: 'Jean',
    projectName: 'jean',
    worktreeName: 'my-feature',
    branch: 'my-feature',
    isMobile: false,
  }

  it('shows project and worktree on a local backend', () => {
    expect(formatWindowTitle(worktree)).toBe('jean › my-feature')
  })

  it('appends the branch when it differs from the worktree name', () => {
    expect(formatWindowTitle({ ...worktree, branch: 'feat/login' })).toBe(
      'jean › my-feature (feat/login)'
    )
  })

  it('falls back to the product name without a selection', () => {
    expect(
      formatWindowTitle({ ...worktree, projectName: null, worktreeName: null })
    ).toBe('Jean')
  })

  it('shows only the project name on mobile', () => {
    expect(formatWindowTitle({ ...worktree, isMobile: true })).toBe('jean')
  })

  it('puts the remote instance name in front of the breadcrumb', () => {
    expect(formatWindowTitle({ ...worktree, remoteName: 'Build server' })).toBe(
      'Build server › jean › my-feature'
    )
  })

  it('shows the instance name alone when nothing is selected', () => {
    expect(
      formatWindowTitle({
        ...worktree,
        projectName: null,
        worktreeName: null,
        remoteName: 'Build server',
      })
    ).toBe('Build server')
  })

  it('keeps the prefix on mobile', () => {
    expect(
      formatWindowTitle({
        ...worktree,
        isMobile: true,
        remoteName: 'Build server',
      })
    ).toBe('Build server › jean')
  })
})
