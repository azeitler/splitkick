import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, within } from '@/test/test-utils'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import type { PeakUsage } from '@/components/titlebar/UsagePopover'
import { MobileTabBar } from './MobileTabBar'

const mocks = vi.hoisted(() => ({
  peak: null as PeakUsage | null,
  unread: 0,
  peakFetchEnabled: [] as boolean[],
}))

vi.mock('@/components/titlebar/UsagePopover', async importOriginal => ({
  ...(await importOriginal<object>()),
  usePeakUsage: (enabled: boolean) => {
    mocks.peakFetchEnabled.push(enabled)
    return mocks.peak
  },
}))

vi.mock('@/components/unread/useUnreadCount', () => ({
  useUnreadCount: () => mocks.unread,
}))

describe('MobileTabBar', () => {
  beforeEach(() => {
    mocks.peak = null
    mocks.unread = 0
    mocks.peakFetchEnabled = []
    useUIStore.setState({
      mobileActiveTab: 'home',
      commandPaletteOpen: false,
      availableCliUpdates: [],
      pendingServerUpdate: null,
      pendingUpdateVersion: null,
      updateReadyVersion: null,
      isUpdateInstalling: false,
    })
    useProjectsStore.setState({ selectedProjectId: null })
  })

  it('offers Home, Starred, History and Usage, in that order', () => {
    render(<MobileTabBar />)

    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual([
      'Home',
      'Starred',
      'History',
      'Usage',
    ])
    expect(screen.getByRole('tab', { name: 'Home' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })

  it('switches the tab', async () => {
    const user = userEvent.setup()
    render(<MobileTabBar />)

    await user.click(screen.getByRole('tab', { name: 'Usage' }))

    expect(useUIStore.getState().mobileActiveTab).toBe('usage')
  })

  it('returns a tab to its root', async () => {
    // Only reachable if a queued session never opened, but a tab must never
    // leave an invisible project selected underneath it.
    useProjectsStore.setState({ selectedProjectId: 'p1' })
    const user = userEvent.setup()
    render(<MobileTabBar />)

    await user.click(screen.getByRole('tab', { name: 'Starred' }))

    expect(useProjectsStore.getState().selectedProjectId).toBeNull()
  })

  it('opens the command palette from the separate search button', async () => {
    const user = userEvent.setup()
    render(<MobileTabBar />)

    await user.click(screen.getByRole('button', { name: 'Search' }))

    expect(useUIStore.getState().commandPaletteOpen).toBe(true)
    // Search is an action, not a destination.
    expect(screen.queryByRole('tab', { name: 'Search' })).toBeNull()
  })

  it('floats above the home indicator with 44px+ targets', () => {
    render(<MobileTabBar />)
    expect(screen.getByTestId('mobile-tab-bar').className).toContain(
      'pb-[calc(var(--safe-area-bottom)+0.75rem)]'
    )
    // Tabs fill the 64px pill less its padding; the search button is 64px.
    expect(screen.getByRole('tablist')).toHaveClass('h-16')
    expect(screen.getByRole('button', { name: 'Search' })).toHaveClass(
      'size-16'
    )
  })

  describe('the Usage icon is a usage ring', () => {
    it('is the plain chart glyph without usage data', () => {
      render(<MobileTabBar />)
      expect(screen.queryByTestId('usage-tab-ring')).toBeNull()
      expect(screen.getByRole('tab', { name: 'Usage' })).toBeInTheDocument()
    })

    it('draws the fullest window as a ring around the glyph', () => {
      mocks.peak = { label: 'Claude · Session', percent: 62.4 }
      render(<MobileTabBar />)

      const ring = screen.getByTestId('usage-tab-ring')
      expect(ring).toHaveAttribute('data-percent', '62')
      const tab = screen.getByRole('tab', {
        name: 'Usage, Claude · Session 62%',
      })
      expect(within(tab).getByTestId('usage-tab-ring')).toBe(ring)
    })

    it('colours the ring by severity', () => {
      mocks.peak = { label: 'Codex · Weekly', percent: 97 }
      render(<MobileTabBar />)
      expect(screen.getByTestId('usage-tab-ring')).toHaveClass(
        'text-destructive'
      )
    })

    it('fetches usage on demand in dev builds, like the desktop badge', () => {
      // Vitest runs in DEV: no fetch until the Usage tab is shown.
      render(<MobileTabBar />)
      expect(mocks.peakFetchEnabled.at(-1)).toBe(false)

      useUIStore.setState({ mobileActiveTab: 'usage' })
      render(<MobileTabBar />)
      expect(mocks.peakFetchEnabled.at(-1)).toBe(true)
    })
  })

  it('badges Home with the unread count the desktop bell shows', () => {
    mocks.unread = 3
    render(<MobileTabBar />)

    expect(screen.getByTestId('home-unread-badge')).toHaveTextContent('3')
    expect(
      screen.getByRole('tab', { name: 'Home, 3 unread' })
    ).toBeInTheDocument()
  })

  it('caps the badge at 99+', () => {
    mocks.unread = 240
    render(<MobileTabBar />)
    expect(screen.getByTestId('home-unread-badge')).toHaveTextContent('99+')
  })
})
