import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@/test/test-utils'
import { useUIStore } from '@/store/ui-store'
import { SidebarFooter } from './SidebarFooter'

const native = vi.hoisted(() => ({ value: true }))
const openExternal = vi.hoisted(() => vi.fn())

vi.mock('@/lib/environment', async importOriginal => ({
  ...(await importOriginal<object>()),
  isNativeApp: () => native.value,
}))
vi.mock('@/lib/platform', async importOriginal => ({
  ...(await importOriginal<object>()),
  openExternal,
}))
vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({ data: undefined }),
}))
vi.mock('@/lib/commands', () => ({
  useCommandContext: () => ({ openPreferences: vi.fn() }),
}))
vi.mock('@/components/unread/UnreadBell', () => ({ UnreadBell: () => null }))
vi.mock('@/components/titlebar/UsagePopover', () => ({
  UsagePopover: () => null,
}))
vi.mock('@/components/remote/RemoteConnectionsDialog', () => ({
  RemoteConnectionsDialog: () => <span data-testid="connections" />,
}))
vi.mock('@tauri-apps/api/app', () => ({
  getVersion: () => Promise.resolve('0.1.73'),
}))

describe('SidebarFooter', () => {
  beforeEach(() => {
    native.value = true
    openExternal.mockClear()
    useUIStore.setState({
      pendingUpdateVersion: null,
      updateReadyVersion: null,
      isUpdateInstalling: false,
      pendingServerUpdate: null,
      availableCliUpdates: [],
    })
  })

  it('offers remote connections only in the native app', () => {
    const { unmount } = render(<SidebarFooter />)
    expect(screen.getByTestId('connections')).toBeInTheDocument()
    unmount()
    native.value = false
    render(<SidebarFooter />)
    expect(screen.queryByTestId('connections')).toBeNull()
  })

  it('shows Updates only while an update waits, with its own action', async () => {
    const { unmount } = render(<SidebarFooter />)
    expect(screen.queryByTestId('sidebar-updates')).toBeNull()
    unmount()

    useUIStore.setState({ updateReadyVersion: '0.1.74' })
    const install = vi.fn()
    window.addEventListener('install-pending-update', install)
    const user = userEvent.setup()
    render(<SidebarFooter />)

    await user.click(screen.getByTestId('sidebar-updates'))
    await user.click(await screen.findByText('Restart to update'))

    expect(install).toHaveBeenCalledTimes(1)
    window.removeEventListener('install-pending-update', install)
  })

  it('keeps GitHub, Sponsor and the release notes in the more menu', async () => {
    const user = userEvent.setup()
    render(<SidebarFooter />)

    await user.click(screen.getByTestId('sidebar-more'))
    await user.click(await screen.findByText('Sponsor Jean'))
    expect(openExternal).toHaveBeenCalledWith(
      'https://jean.build/sponsorships/'
    )

    await user.click(screen.getByTestId('sidebar-more'))
    expect(await screen.findByText('GitHub')).toBeInTheDocument()
    expect(screen.getByText('Release notes')).toBeInTheDocument()
    expect(await screen.findByText('v0.1.73')).toBeInTheDocument()
  })
})
