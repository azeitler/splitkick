import { act, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@/test/test-utils'
import { useUIStore } from '@/store/ui-store'
import { FIRST_START_SETTLE_MS } from '@/lib/first-start-gate'
import { UpdateAvailableModal } from './UpdateAvailableModal'

describe('UpdateAvailableModal', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useUIStore.setState({
      onboardingOpen: false,
      featureTourOpen: false,
      jeanMcpIntroOpen: false,
      updateModalVersion: null,
      updateReadyVersion: null,
      isUpdateInstalling: false,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    useUIStore.setState({ updateModalVersion: null })
  })

  it('waits while the setup dialog or the tour runs, then shows', () => {
    useUIStore.setState({ onboardingOpen: true, updateModalVersion: '9.9.9' })
    render(<UpdateAvailableModal />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    act(() =>
      useUIStore.setState({ onboardingOpen: false, featureTourOpen: true })
    )
    act(() => vi.advanceTimersByTime(FIRST_START_SETTLE_MS * 2))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    act(() => useUIStore.setState({ featureTourOpen: false }))
    act(() => vi.advanceTimersByTime(FIRST_START_SETTLE_MS))
    expect(
      screen.getByRole('dialog', { name: 'Update Available' })
    ).toBeInTheDocument()
    // Queued, not dropped: the version is still pending
    expect(useUIStore.getState().updateModalVersion).toBe('9.9.9')
  })

  it('waits while the MCP intro is open', () => {
    useUIStore.setState({ jeanMcpIntroOpen: true, updateModalVersion: '9.9.9' })
    render(<UpdateAvailableModal />)
    act(() => vi.advanceTimersByTime(FIRST_START_SETTLE_MS * 2))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    act(() => useUIStore.setState({ jeanMcpIntroOpen: false }))
    expect(
      screen.getByRole('dialog', { name: 'Update Available' })
    ).toBeInTheDocument()
  })

  it('shows at once outside the first start', () => {
    useUIStore.setState({ updateModalVersion: '9.9.9' })
    render(<UpdateAvailableModal />)
    expect(
      screen.getByRole('dialog', { name: 'Update Available' })
    ).toBeInTheDocument()
  })
})
