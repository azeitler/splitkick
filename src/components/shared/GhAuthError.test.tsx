import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/store/ui-store'
import { GhAuthError } from './GhAuthError'

describe('GhAuthError', () => {
  beforeEach(() => {
    useUIStore.setState({ onboardingOpen: false, onboardingStartStep: null })
  })

  it('offers the GitHub CLI setup when gh is not installed', async () => {
    const onLogin = vi.fn()
    render(<GhAuthError onLogin={onLogin} isGhInstalled={false} />)

    expect(screen.getByText('GitHub CLI is not set up')).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: 'Set up GitHub CLI' })
    )

    expect(useUIStore.getState().onboardingOpen).toBe(true)
    expect(useUIStore.getState().onboardingStartStep).toBe('gh')
    expect(onLogin).not.toHaveBeenCalled()
  })

  it('offers the login when gh is installed but not logged in', async () => {
    const onLogin = vi.fn()
    render(<GhAuthError onLogin={onLogin} isGhInstalled />)

    expect(screen.getByText('GitHub CLI is not set up')).toBeInTheDocument()
    await userEvent.click(
      screen.getByRole('button', { name: 'Sign in to GitHub' })
    )

    expect(onLogin).toHaveBeenCalledOnce()
  })
})
