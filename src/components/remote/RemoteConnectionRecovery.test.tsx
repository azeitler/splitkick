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

// The real dialog needs the full connection store; a stub that answers the
// open event proves the recovery screen mounts one.
vi.mock('./RemoteConnectionsDialog', async () => {
  const { useEffect, useState } = await import('react')
  return {
    RemoteConnectionsDialog: ({ showTrigger }: { showTrigger?: boolean }) => {
      const [openId, setOpenId] = useState<string | null>(null)
      useEffect(() => {
        const onOpen = (event: Event) =>
          setOpenId(
            (event as CustomEvent<{ id?: string }>).detail?.id ?? 'none'
          )
        window.addEventListener('open-remote-connections', onOpen)
        return () =>
          window.removeEventListener('open-remote-connections', onOpen)
      }, [])
      return (
        <div
          data-testid="connections-dialog"
          data-trigger={String(showTrigger)}
        >
          {openId ? `editing ${openId}` : null}
        </div>
      )
    },
  }
})

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
      screen.getByRole('button', { name: 'Switch to Local' })
    ).toBeInTheDocument()
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

  it('opens the connection editor from "Edit connection"', () => {
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

    const dialog = screen.getByTestId('connections-dialog')
    expect(dialog).toHaveAttribute('data-trigger', 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Edit connection' }))
    expect(dialog).toHaveTextContent('editing remote-1')
  })
})
