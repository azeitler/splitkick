import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@/test/test-utils'
import { useUIStore } from '@/store/ui-store'
import { ToolbarContent, ToolbarSlotsProvider } from './toolbar-slots'
import { WindowToolbar } from './WindowToolbar'

const platform = vi.hoisted(() => ({
  native: true,
  mac: true,
  linux: false,
}))

const remote = vi.hoisted(() => ({
  connection: null as null | {
    id: string
    name: string
    url: string
    token: string
  },
}))

vi.mock('@/lib/remote-connections', async importOriginal => ({
  ...(await importOriginal<object>()),
  useActiveRemoteConnection: () => remote.connection,
}))

vi.mock('@/lib/environment', async importOriginal => ({
  ...(await importOriginal<object>()),
  isNativeApp: () => platform.native,
}))
vi.mock('@/lib/platform', async importOriginal => ({
  ...(await importOriginal<object>()),
  get isClientMacOS() {
    return platform.mac
  },
  get isClientLinux() {
    return platform.linux
  },
}))
vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({ data: undefined }),
}))
vi.mock('@/components/unread/UnreadBell', () => ({
  UnreadBell: () => <span data-testid="unread-bell" />,
}))
vi.mock('@/components/home/useIsHomeActive', () => ({
  useIsHomeActive: () => false,
}))
vi.mock('@/components/titlebar/LinuxWindowControls', () => ({
  LinuxWindowControls: () => <span data-testid="linux-controls" />,
}))

function renderToolbar() {
  return render(
    <ToolbarSlotsProvider>
      <WindowToolbar fallbackTitle="jean" />
    </ToolbarSlotsProvider>
  )
}

const toolbar = () => screen.getByTestId('window-toolbar')
const hasInset = () => toolbar().querySelector('.w-\\[78px\\]') !== null

describe('WindowToolbar', () => {
  beforeEach(() => {
    Object.assign(platform, { native: true, mac: true, linux: false })
    useUIStore.setState({ zenMode: false, leftSidebarVisible: true })
    remote.connection = null
  })

  it('leaves the traffic lights to the sidebar while it shows', () => {
    renderToolbar()
    expect(hasInset()).toBe(false)
    expect(screen.queryByTestId('toggle-left-sidebar')).toBeNull()
  })

  it('takes the traffic lights and the sidebar toggle when the sidebar hides', () => {
    useUIStore.setState({ leftSidebarVisible: false })
    renderToolbar()
    expect(hasInset()).toBe(true)
    expect(screen.getByTestId('toggle-left-sidebar')).toBeInTheDocument()
  })

  it('has no traffic-light inset off native macOS', () => {
    useUIStore.setState({ leftSidebarVisible: false })
    platform.mac = false
    renderToolbar()
    expect(hasInset()).toBe(false)
    expect(screen.getByTestId('toggle-left-sidebar')).toBeInTheDocument()
  })

  it('shows only the title, the bell and the way out in zen', () => {
    useUIStore.setState({ zenMode: true, leftSidebarVisible: false })
    renderToolbar()
    expect(toolbar()).toHaveTextContent('jean')
    expect(screen.getByTestId('unread-bell')).toBeInTheDocument()
    expect(screen.getByTestId('toggle-zen-mode')).toBeInTheDocument()
    expect(screen.queryByTestId('navigate-back')).toBeNull()
    expect(screen.queryByTestId('toggle-file-browser')).toBeNull()
    expect(screen.queryByTestId('toggle-left-sidebar')).toBeNull()
  })

  it('drags the window natively, never in web access', () => {
    const { unmount } = renderToolbar()
    expect(toolbar()).toHaveAttribute('data-tauri-drag-region')
    unmount()
    platform.native = false
    renderToolbar()
    expect(toolbar()).not.toHaveAttribute('data-tauri-drag-region')
  })

  it('draws window controls only in the native Linux app', () => {
    const { unmount } = renderToolbar()
    expect(screen.queryByTestId('linux-controls')).toBeNull()
    unmount()
    Object.assign(platform, { mac: false, linux: true })
    renderToolbar()
    expect(screen.getByTestId('linux-controls')).toBeInTheDocument()
  })

  it('shows no remote badge in the local window', () => {
    renderToolbar()
    expect(screen.queryByTestId('remote-instance-badge')).toBeNull()
  })

  // The regression: the remote name lived only in the fallback title, and every
  // view that fills the title slot hid it, so a remote window looked local.
  it('names the remote instance even while a view owns the title', () => {
    remote.connection = {
      id: 'r1',
      name: 'mac-2',
      url: 'http://mac-2.tailnet:3456',
      token: 't',
    }
    render(
      <ToolbarSlotsProvider>
        <WindowToolbar fallbackTitle="mac-2 › jean" />
        <ToolbarContent title="jean project" />
      </ToolbarSlotsProvider>
    )
    expect(screen.queryByText('mac-2 › jean')).toBeNull()
    expect(screen.getByTestId('remote-instance-badge')).toHaveTextContent(
      'mac-2'
    )
    expect(screen.getByLabelText('Remote instance mac-2')).toBeInTheDocument()
  })

  it('keeps the remote badge in zen', () => {
    remote.connection = { id: 'r1', name: 'mac-2', url: 'not a url', token: 't' }
    useUIStore.setState({ zenMode: true, leftSidebarVisible: false })
    renderToolbar()
    expect(screen.getByTestId('remote-instance-badge')).toHaveTextContent(
      'mac-2'
    )
  })
})
