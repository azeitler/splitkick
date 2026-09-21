import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RemoteConnectionRecovery } from './RemoteConnectionRecovery'

const dismissTransientUi = vi.fn()

vi.mock('@/lib/dismiss-transient-ui', () => ({
  dismissTransientUi: () => dismissTransientUi(),
}))

const isConnectionWindow = vi.fn(() => false)
const focusMainWindow = vi.fn(async () => undefined)
const destroyAppWindow = vi.fn(async () => undefined)

vi.mock('@/lib/connection-windows', () => ({
  focusMainWindow: () => focusMainWindow(),
}))

vi.mock('@/lib/window-close', () => ({
  destroyAppWindow: () => destroyAppWindow(),
}))

vi.mock('@/lib/remote-connections', () => ({
  LOCAL_CONNECTION_ID: 'local',
  isConnectionWindow: () => isConnectionWindow(),
  markConnectionSwitch: vi.fn(),
  selectConnection: vi.fn(),
}))

describe('RemoteConnectionRecovery', () => {
  beforeEach(() => {
    dismissTransientUi.mockClear()
    isConnectionWindow.mockReturnValue(false)
    focusMainWindow.mockClear()
    destroyAppWindow.mockClear()
  })

  it('dismisses open overlays on mount so recovery stays interactive', () => {
    render(
      <RemoteConnectionRecovery
        connection={{
          id: 'remote-1',
          name: 'Lab',
          url: 'https://lab.example',
          token: 'tok',
        }}
        error="Connection to the selected Jean server was lost."
      />
    )

    expect(dismissTransientUi).toHaveBeenCalledOnce()
    expect(
      screen.getByRole('heading', { name: /Couldn't connect to Lab/i })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Switch to Local' })
    ).not.toBeInTheDocument()
  })

  it('uses a z-index above dialogs and menus', () => {
    const { container } = render(
      <RemoteConnectionRecovery
        connection={{
          id: 'remote-1',
          name: 'Lab',
          url: 'https://lab.example',
          token: 'tok',
        }}
        error="lost"
      />
    )

    const root = container.firstElementChild as HTMLElement
    expect(root.className).toContain('z-[100]')
  })

  it('closes a connection window instead of offering to become local', async () => {
    // Local lives in the main window, so this window has nowhere to switch to.
    isConnectionWindow.mockReturnValue(true)

    render(
      <RemoteConnectionRecovery
        connection={{
          id: 'remote-1',
          name: 'Lab',
          url: 'https://lab.example',
          token: 'tok',
        }}
        error="lost"
      />
    )

    expect(
      screen.queryByRole('button', { name: 'Switch to Local' })
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close window' }))

    await waitFor(() => expect(destroyAppWindow).toHaveBeenCalledOnce())
    expect(focusMainWindow).toHaveBeenCalledOnce()
  })

  it('automatically retries the connection every 10 seconds', () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval')

    const { unmount } = render(
      <RemoteConnectionRecovery
        connection={{
          id: 'remote-1',
          name: 'Lab',
          url: 'https://lab.example',
          token: 'tok',
        }}
        error="lost"
      />
    )

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 10_000)

    unmount()
    setIntervalSpy.mockRestore()
  })
})
