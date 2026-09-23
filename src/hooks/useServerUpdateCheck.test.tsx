import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useUIStore, type PendingServerUpdate } from '@/store/ui-store'
import { applyServerUpdate, useServerUpdateCheck } from './useServerUpdateCheck'

const invokeMock = vi.fn()
const isLocalBackendMock = vi.fn(() => false)
const listeners = new Map<string, (event: { payload: unknown }) => void>()

vi.mock('@/lib/transport', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  listen: (event: string, handler: (e: { payload: unknown }) => void) => {
    listeners.set(event, handler)
    return Promise.resolve(() => listeners.delete(event))
  },
}))

vi.mock('@/lib/environment', () => ({
  isLocalBackend: () => isLocalBackendMock(),
}))

vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
    loading: vi.fn(() => 'toast-id'),
    success: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn(),
  },
}))

const serverPending: PendingServerUpdate = {
  latestVersion: '1.2.0',
  currentVersion: '1.0.0',
  canUpdate: true,
  reason: null,
  channel: 'server',
  hostInstallPhase: 'idle',
  hostInstallMessage: null,
}

function reset() {
  useUIStore.getState().setPendingServerUpdate(null)
  useUIStore.getState().setPendingUpdateVersion(null)
  useUIStore.getState().setUpdateModalVersion(null)
}

describe('useServerUpdateCheck', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    invokeMock.mockReset()
    listeners.clear()
    isLocalBackendMock.mockReturnValue(false)
    reset()
  })

  afterEach(() => {
    vi.useRealTimers()
    reset()
  })

  it('stores a sticky pending server update that survives toast-only dismissal', async () => {
    invokeMock.mockResolvedValue({
      updateAvailable: true,
      currentVersion: '1.0.0',
      latestVersion: '1.2.0',
      canUpdate: true,
      reason: null,
      channel: 'server',
    })

    renderHook(() => useServerUpdateCheck())

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000)
    })

    expect(useUIStore.getState().pendingServerUpdate).toEqual(serverPending)
  })

  it('shows a desktop host update as a host badge, not this app update', async () => {
    invokeMock.mockResolvedValue({
      updateAvailable: true,
      currentVersion: '0.1.73-z.13',
      latestVersion: '0.1.73-z.15',
      canUpdate: true,
      reason: 'Install runs on the host Jean desktop app (native updater)',
      channel: 'desktop',
      hostInstall: { phase: 'idle', version: null, message: null },
    })

    renderHook(() => useServerUpdateCheck())

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000)
    })

    expect(useUIStore.getState().pendingServerUpdate).toEqual({
      latestVersion: '0.1.73-z.15',
      currentVersion: '0.1.73-z.13',
      canUpdate: true,
      reason: 'Install runs on the host Jean desktop app (native updater)',
      channel: 'desktop',
      hostInstallPhase: 'idle',
      hostInstallMessage: null,
    })
    // The local app-update state must stay untouched (that badge means *this*
    // app needs updating).
    expect(useUIStore.getState().updateModalVersion).toBeNull()
    expect(useUIStore.getState().pendingUpdateVersion).toBeNull()
  })

  it('folds host install progress from host:update-state into the badge', async () => {
    invokeMock.mockResolvedValue({
      updateAvailable: true,
      currentVersion: '0.1.73-z.13',
      latestVersion: '0.1.73-z.15',
      canUpdate: true,
      channel: 'desktop',
    })

    renderHook(() => useServerUpdateCheck())

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000)
    })

    await act(async () => {
      listeners.get('host:update-state')?.({
        payload: { phase: 'downloading', version: '0.1.73-z.15' },
      })
    })
    expect(useUIStore.getState().pendingServerUpdate?.hostInstallPhase).toBe(
      'downloading'
    )

    await act(async () => {
      listeners.get('host:update-state')?.({
        payload: { phase: 'ready', version: '0.1.73-z.15' },
      })
    })
    expect(useUIStore.getState().pendingServerUpdate?.hostInstallPhase).toBe(
      'ready'
    )
  })

  it('clears the badge once a later check finds the host is current', async () => {
    invokeMock.mockResolvedValueOnce({
      updateAvailable: true,
      currentVersion: '0.1.73-z.13',
      latestVersion: '0.1.73-z.15',
      canUpdate: true,
      channel: 'desktop',
    })

    renderHook(() => useServerUpdateCheck())

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000)
    })
    expect(useUIStore.getState().pendingServerUpdate).not.toBeNull()

    invokeMock.mockResolvedValue({
      updateAvailable: false,
      currentVersion: '0.1.73-z.15',
      latestVersion: '0.1.73-z.15',
      canUpdate: false,
      channel: 'desktop',
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
    })

    expect(useUIStore.getState().pendingServerUpdate).toBeNull()
  })

  it('clears sticky state after a restart-scheduled apply', async () => {
    useUIStore.getState().setPendingServerUpdate(serverPending)

    invokeMock.mockResolvedValue({
      success: true,
      version: '1.2.0',
      message: 'Installed jean-server 1.2.0; restart scheduled',
      restartScheduled: true,
    })

    await applyServerUpdate('1.2.0')

    expect(useUIStore.getState().pendingServerUpdate).toBeNull()
    expect(invokeMock).toHaveBeenCalledWith('apply_server_update')
  })

  it('keeps the badge when a desktop host only accepted the request', async () => {
    const desktopPending = {
      ...serverPending,
      channel: 'desktop' as const,
      latestVersion: '0.1.73-z.15',
    }
    useUIStore.getState().setPendingServerUpdate(desktopPending)

    invokeMock.mockResolvedValue({
      success: true,
      version: '0.1.73-z.15',
      message: 'Update requested on the host desktop app',
      restartScheduled: false,
    })

    await applyServerUpdate('0.1.73-z.15')

    // Nothing is installed yet — clearing here is what made the badge come
    // back on the next check and look permanent.
    expect(useUIStore.getState().pendingServerUpdate).toEqual(desktopPending)
  })

  it('keeps sticky state when apply fails so the user can retry', async () => {
    useUIStore.getState().setPendingServerUpdate(serverPending)

    invokeMock.mockRejectedValue(new Error('sessions still running'))

    await applyServerUpdate('1.2.0')

    expect(useUIStore.getState().pendingServerUpdate).toEqual(serverPending)
  })
})
