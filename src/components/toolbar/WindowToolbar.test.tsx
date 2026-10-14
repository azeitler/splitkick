import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@/test/test-utils'
import { useUIStore } from '@/store/ui-store'
import { ToolbarSlotsProvider } from './toolbar-slots'
import { WindowToolbar } from './WindowToolbar'

const platform = vi.hoisted(() => ({
  native: true,
  mac: true,
  linux: false,
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
const hasInset = () =>
  toolbar().querySelector('.w-\\[78px\\]') !== null

describe('WindowToolbar', () => {
  beforeEach(() => {
    Object.assign(platform, { native: true, mac: true, linux: false })
    useUIStore.setState({ zenMode: false, leftSidebarVisible: true })
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
})
