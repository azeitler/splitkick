import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/store/ui-store'

const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError } }))

import {
  GH_CLI_NOT_SET_UP,
  isGhAuthError,
  openGhCliSetup,
  toastGitHubError,
} from './gh-cli-setup'

const MISSING_GH =
  'Failed to run gh pr create: No such file or directory (os error 2)'

describe('isGhAuthError', () => {
  it('detects a missing gh binary on macOS and Linux', () => {
    expect(isGhAuthError(MISSING_GH)).toBe(true)
    expect(isGhAuthError('Failed to execute gh: not found')).toBe(true)
    expect(isGhAuthError('GitHub CLI not installed')).toBe(true)
  })

  it('does not match other tools', () => {
    expect(isGhAuthError('Failed to run git push: rejected')).toBe(false)
    expect(isGhAuthError('Failed to run ghostscript')).toBe(false)
  })
})

describe('toastGitHubError', () => {
  beforeEach(() => {
    toastError.mockClear()
    useUIStore.setState({
      onboardingOpen: false,
      onboardingStartStep: null,
      onboardingManuallyTriggered: false,
      onboardingDismissed: true,
    })
  })

  it('shows "GitHub CLI is not set up" with a Set up action', () => {
    toastGitHubError('Failed to create PR', MISSING_GH, { id: 't-1' })

    const [title, options] = toastError.mock.calls[0] as [
      string,
      { id: string; action: { label: string; onClick: () => void } },
    ]
    expect(title).toBe(GH_CLI_NOT_SET_UP)
    expect(title).not.toContain('os error')
    expect(options.id).toBe('t-1')
    expect(options.action.label).toBe('Set up')

    options.action.onClick()
    expect(useUIStore.getState()).toMatchObject({
      onboardingOpen: true,
      onboardingStartStep: 'gh',
      onboardingManuallyTriggered: true,
      onboardingDismissed: false,
    })
  })

  it('treats a logged-out gh the same way', () => {
    toastGitHubError(
      'Failed to merge PR',
      "GitHub CLI not authenticated. Run 'gh auth login' first."
    )
    expect(toastError.mock.calls[0]?.[0]).toBe(GH_CLI_NOT_SET_UP)
  })

  it('keeps other errors as they are', () => {
    toastGitHubError('Failed to merge PR', 'Pull request is not mergeable')
    expect(toastError).toHaveBeenCalledWith(
      'Failed to merge PR: Pull request is not mergeable',
      { id: undefined }
    )
  })

  it('openGhCliSetup opens the wizard on the GitHub CLI step', () => {
    openGhCliSetup()
    expect(useUIStore.getState().onboardingStartStep).toBe('gh')
    expect(useUIStore.getState().onboardingOpen).toBe(true)
  })
})
