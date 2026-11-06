import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@/test/test-utils'
import { useUIStore } from '@/store/ui-store'
import { setServerPlatform } from '@/lib/platform'
import { SidebarFooter } from './SidebarFooter'

const native = vi.hoisted(() => ({ value: true }))
const openExternal = vi.hoisted(() => vi.fn())
const mobile = vi.hoisted(() => ({ value: false }))
const checkForUpdatesManually = vi.hoisted(() => vi.fn())

vi.mock('@/lib/environment', async importOriginal => ({
  ...(await importOriginal<object>()),
  isNativeApp: () => native.value,
}))
vi.mock('@/lib/platform', async importOriginal => ({
  ...(await importOriginal<object>()),
  openExternal,
}))
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => mobile.value }))
vi.mock('@/lib/app-update', async importOriginal => ({
  ...(await importOriginal<object>()),
  checkForUpdatesManually,
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
    mobile.value = false
    openExternal.mockClear()
    checkForUpdatesManually.mockClear()
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

  it('keeps GitHub, the website and the release notes in the more menu', async () => {
    const user = userEvent.setup()
    render(<SidebarFooter />)

    await user.click(screen.getByTestId('sidebar-more'))
    await user.click(await screen.findByText('Website'))
    expect(openExternal).toHaveBeenCalledWith('https://splitkick.app')

    await user.click(screen.getByTestId('sidebar-more'))
    await user.click(await screen.findByText('GitHub'))
    expect(openExternal).toHaveBeenCalledWith(
      'https://github.com/azeitler/splitkick'
    )

    await user.click(screen.getByTestId('sidebar-more'))
    expect(screen.getByText('Release notes')).toBeInTheDocument()
    expect(await screen.findByText('v0.1.73')).toBeInTheDocument()
  })

  it.each(['windows', 'mac', 'linux'] as const)(
    'offers Check for Updates in the native %s app and runs the shared check',
    async platform => {
      setServerPlatform(platform)
      const user = userEvent.setup()
      render(<SidebarFooter />)

      await user.click(screen.getByTestId('sidebar-more'))
      await user.click(await screen.findByText('Check for Updates…'))

      expect(checkForUpdatesManually).toHaveBeenCalledTimes(1)
      setServerPlatform('linux')
    }
  )

  it.each([
    ['Web Access', { native: false, mobile: false }],
    ['mobile', { native: false, mobile: true }],
    ['a mobile-width native window', { native: true, mobile: true }],
  ])('hides Check for Updates in %s', async (_label, mode) => {
    native.value = mode.native
    mobile.value = mode.mobile
    const user = userEvent.setup()
    render(<SidebarFooter />)

    await user.click(screen.getByTestId('sidebar-more'))
    expect(await screen.findByText('Website')).toBeInTheDocument()
    expect(screen.queryByText('Check for Updates…')).toBeNull()
  })
})
