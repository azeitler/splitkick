import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@/lib/transport'
import { logNativeError } from '@/lib/native-log'
import { useUIStore as staticUIStore } from '@/store/ui-store'
import {
  RELEASE_IDENTIFIER,
  type AppUpdateGuardState,
  describeUpdateCheckFailure,
  installAndRelaunch,
  isUpdateCheckEnabled,
  markAppUpdateReady,
  offerAppUpdate,
  UPDATE_AVAILABLE_TOAST_ID,
  UPDATE_READY_TOAST_ID,
  resolveInstallPendingAction,
  shouldOfferUpdateCheck,
} from './app-update'

vi.mock('@/lib/transport', () => ({ invoke: vi.fn() }))
vi.mock('@/lib/native-log', () => ({ logNativeError: vi.fn() }))

describe('describeUpdateCheckFailure', () => {
  const pluginError = 'Could not fetch a valid release JSON from the remote'

  beforeEach(() => {
    vi.mocked(invoke).mockReset()
    vi.mocked(logNativeError).mockReset()
  })

  it('adds the cause the plugin drops and logs it (#113)', async () => {
    vi.mocked(invoke).mockResolvedValue(
      'github.com answered HTTP 504 (text/html)'
    )
    const message = await describeUpdateCheckFailure(pluginError)
    expect(invoke).toHaveBeenCalledWith('diagnose_update_check')
    expect(message).toBe(
      `${pluginError} (github.com answered HTTP 504 (text/html))`
    )
    expect(logNativeError).toHaveBeenCalledWith(
      `Update check failed: ${message}`
    )
  })

  it('keeps the original error when the diagnosis fails', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('Unknown command'))
    const message = await describeUpdateCheckFailure(pluginError)
    expect(message).toBe(
      `${pluginError} (diagnosis failed: Error: Unknown command)`
    )
    expect(logNativeError).toHaveBeenCalledOnce()
  })
})

describe('isUpdateCheckEnabled', () => {
  it('checks for updates only in the released app', () => {
    expect(isUpdateCheckEnabled(RELEASE_IDENTIFIER)).toBe(true)
  })

  it('skips dev builds, test builds and the upstream base config', () => {
    for (const id of [
      'app.splitkick.desktop.dev',
      'app.splitkick.desktop.rel76',
      'com.jean.desktop',
      '',
    ]) {
      expect(isUpdateCheckEnabled(id)).toBe(false)
    }
  })
})

describe('shouldOfferUpdateCheck', () => {
  it('offers a check when idle', () => {
    expect(
      shouldOfferUpdateCheck({
        pendingUpdateVersion: null,
        updateReadyVersion: null,
        isUpdateInstalling: false,
      })
    ).toBe(true)
  })

  it('skips when user deferred the update (badge showing)', () => {
    expect(
      shouldOfferUpdateCheck({
        pendingUpdateVersion: '1.2.3',
        updateReadyVersion: null,
        isUpdateInstalling: false,
      })
    ).toBe(false)
  })

  it('skips while a download/install is in progress', () => {
    expect(
      shouldOfferUpdateCheck({
        pendingUpdateVersion: '1.2.3',
        updateReadyVersion: null,
        isUpdateInstalling: true,
      })
    ).toBe(false)
  })

  it('skips when update is already installed and waiting for restart (#507)', () => {
    expect(
      shouldOfferUpdateCheck({
        pendingUpdateVersion: null,
        updateReadyVersion: '1.2.3',
        isUpdateInstalling: false,
      })
    ).toBe(false)
  })
})

describe('resolveInstallPendingAction', () => {
  it('relaunches when the package is already ready', () => {
    expect(
      resolveInstallPendingAction({
        updateReadyVersion: '1.2.3',
        isUpdateInstalling: false,
        hasPendingUpdateObject: true,
      })
    ).toBe('relaunch')
  })

  it('prefers relaunch over install even if an update object still exists', () => {
    expect(
      resolveInstallPendingAction({
        updateReadyVersion: '1.2.3',
        isUpdateInstalling: false,
        hasPendingUpdateObject: true,
      })
    ).toBe('relaunch')
  })

  it('is a no-op while installing', () => {
    expect(
      resolveInstallPendingAction({
        updateReadyVersion: null,
        isUpdateInstalling: true,
        hasPendingUpdateObject: true,
      })
    ).toBe('noop')
  })

  it('installs when an update object is available', () => {
    expect(
      resolveInstallPendingAction({
        updateReadyVersion: null,
        isUpdateInstalling: false,
        hasPendingUpdateObject: true,
      })
    ).toBe('install')
  })

  it('is a no-op when nothing is pending', () => {
    expect(
      resolveInstallPendingAction({
        updateReadyVersion: null,
        isUpdateInstalling: false,
        hasPendingUpdateObject: false,
      })
    ).toBe('noop')
  })
})

describe('installAndRelaunch', () => {
  it('installs the downloaded update before the relaunch', async () => {
    const calls: string[] = []
    await installAndRelaunch(
      { install: async () => void calls.push('install') },
      async () => void calls.push('relaunch')
    )
    expect(calls).toEqual(['install', 'relaunch'])
  })

  it('only relaunches when nothing was downloaded', async () => {
    const relaunch = vi.fn(async () => undefined)
    await installAndRelaunch(null, relaunch)
    expect(relaunch).toHaveBeenCalledOnce()
  })

  it('does not relaunch when the install fails', async () => {
    const relaunch = vi.fn(async () => undefined)
    await expect(
      installAndRelaunch(
        {
          install: async () => {
            throw new Error('bad signature')
          },
        },
        relaunch
      )
    ).rejects.toThrow('bad signature')
    expect(relaunch).not.toHaveBeenCalled()
  })
})

const updater = vi.hoisted(() => ({
  identifier: 'app.splitkick.desktop',
  native: true,
  check: vi.fn(),
  notify: vi.fn(),
  logInfo: vi.fn(),
  message: vi.fn(() => Promise.resolve()),
  loading: vi.fn(() => 'checking-toast'),
  dismiss: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
}))

vi.mock('@tauri-apps/api/app', () => ({
  getIdentifier: () => Promise.resolve(updater.identifier),
  getVersion: () => Promise.resolve('1.5.12'),
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ message: updater.message }))
vi.mock('@tauri-apps/plugin-updater', () => ({ check: updater.check }))
vi.mock('@/lib/environment', async importOriginal => ({
  ...(await importOriginal<object>()),
  isNativeApp: () => updater.native,
}))
vi.mock('@/lib/notifications', () => ({ notify: updater.notify }))
vi.mock('@/lib/native-log', () => ({
  logNativeError: vi.fn(),
  logNativeInfo: updater.logInfo,
}))
vi.mock('sonner', () => ({
  toast: {
    loading: updater.loading,
    dismiss: updater.dismiss,
    success: updater.success,
    info: updater.info,
  },
}))

describe('checkForUpdatesManually (#100)', () => {
  // Fresh modules each test: the enabled flag is cached per module instance.
  async function load(ui: Partial<AppUpdateGuardState> = {}) {
    vi.resetModules()
    const [{ checkForUpdatesManually }, { useUIStore }] = await Promise.all([
      import('./app-update'),
      import('@/store/ui-store'),
    ])
    useUIStore.setState({
      updateReadyVersion: null,
      isUpdateInstalling: false,
      updateModalVersion: null,
      ...ui,
    })
    return { checkForUpdatesManually, useUIStore }
  }

  beforeEach(() => {
    updater.identifier = RELEASE_IDENTIFIER
    updater.native = true
    updater.check.mockReset()
    updater.notify.mockReset()
    updater.logInfo.mockReset()
    updater.message.mockClear()
    updater.loading.mockClear()
    updater.dismiss.mockReset()
  })

  it('shows that it checks, logs the result and uses a timeout', async () => {
    updater.check.mockResolvedValue(null)
    const { checkForUpdatesManually } = await load()

    await checkForUpdatesManually()

    expect(updater.loading).toHaveBeenCalledWith('Checking for updates…')
    expect(updater.dismiss).toHaveBeenCalledWith('checking-toast')
    expect(updater.check).toHaveBeenCalledWith({ timeout: 30_000 })
    expect(updater.logInfo).toHaveBeenCalledWith(
      'Update check (manual): started'
    )
    expect(updater.logInfo).toHaveBeenCalledWith(
      'Update check (manual): no newer version'
    )
  })

  it('does nothing outside the native app', async () => {
    updater.native = false
    const { checkForUpdatesManually } = await load()
    await checkForUpdatesManually()
    expect(updater.check).not.toHaveBeenCalled()
    expect(updater.notify).not.toHaveBeenCalled()
  })

  it('says updates are off in a development build', async () => {
    updater.identifier = 'app.splitkick.desktop.dev'
    const { checkForUpdatesManually, useUIStore } = await load()
    await checkForUpdatesManually()
    expect(updater.check).not.toHaveBeenCalled()
    expect(useUIStore.getState().updateCheckResult).toEqual({
      text: 'Updates are off in development builds.',
      kind: 'info',
    })
    expect(updater.message).not.toHaveBeenCalled()
  })

  it('opens the restart prompt again when an update is ready', async () => {
    const { checkForUpdatesManually, useUIStore } = await load({
      updateReadyVersion: '1.2.3',
    })
    await checkForUpdatesManually()
    expect(updater.check).not.toHaveBeenCalled()
    expect(useUIStore.getState().updateModalVersion).toBe('1.2.3')
    expect(updater.notify).not.toHaveBeenCalled()
  })

  it('does not check again while a download runs', async () => {
    const { checkForUpdatesManually, useUIStore } = await load({
      isUpdateInstalling: true,
    })
    await checkForUpdatesManually()
    expect(updater.check).not.toHaveBeenCalled()
    expect(useUIStore.getState().updateCheckResult).toEqual({
      text: 'An update is downloading. Splitkick asks you to restart when it is ready.',
      kind: 'info',
    })
    expect(updater.message).not.toHaveBeenCalled()
  })

  it('opens the update modal when an update is found', async () => {
    const update = { version: '9.9.9' }
    updater.check.mockResolvedValue(update)
    const onAvailable = vi.fn()
    window.addEventListener('update-available', onAvailable)
    const { checkForUpdatesManually, useUIStore } = await load()

    await checkForUpdatesManually()

    window.removeEventListener('update-available', onAvailable)
    expect(onAvailable).toHaveBeenCalledTimes(1)
    expect((onAvailable.mock.calls[0]?.[0] as CustomEvent).detail).toBe(update)
    expect(useUIStore.getState().updateModalVersion).toBe('9.9.9')
    expect(updater.notify).not.toHaveBeenCalled()
  })

  it('says the app is current when no update is found', async () => {
    updater.check.mockResolvedValue(null)
    const { checkForUpdatesManually, useUIStore } = await load()
    await checkForUpdatesManually()
    expect(useUIStore.getState().updateCheckResult).toEqual({
      text: 'You are running the latest version (1.5.12).',
      kind: 'info',
    })
    expect(updater.message).not.toHaveBeenCalled()
    expect(updater.notify).not.toHaveBeenCalled()
  })

  it('reports a failed check', async () => {
    updater.check.mockRejectedValue(new Error('offline'))
    vi.mocked(invoke).mockResolvedValue('could not reach github.com: timeout')
    const { checkForUpdatesManually, useUIStore } = await load()
    await checkForUpdatesManually()
    expect(useUIStore.getState().updateCheckResult).toEqual({
      text: 'The update check failed: Error: offline (could not reach github.com: timeout)',
      kind: 'error',
    })
    expect(updater.message).not.toHaveBeenCalled()
  })
})

describe('offerAppUpdate', () => {
  it('shows a toast with Update and marks the update pending, no modal', () => {
    const useUIStore = staticUIStore
    useUIStore.setState({
      pendingUpdateVersion: null,
      updateModalVersion: null,
    })
    updater.info.mockReset()

    offerAppUpdate('2.1.0')

    const state = useUIStore.getState()
    // The toolbar's "Update available" reads this; it outlives the toast.
    expect(state.pendingUpdateVersion).toBe('2.1.0')
    expect(state.updateModalVersion).toBeNull()
    const [text, options] = updater.info.mock.calls[0] as unknown as [
      string,
      {
        id: string
        duration: number
        action: { label: string; onClick: () => void }
      },
    ]
    expect(text).toContain('2.1.0 is available')
    expect(options.id).toBe(UPDATE_AVAILABLE_TOAST_ID)
    expect(options.duration).toBe(Infinity)
    expect(options.action.label).toBe('Update')
    const install = vi.fn()
    window.addEventListener('install-pending-update', install)
    options.action.onClick()
    window.removeEventListener('install-pending-update', install)
    expect(install).toHaveBeenCalledTimes(1)
  })
})

describe('markAppUpdateReady (#135)', () => {
  async function load() {
    // The modules imported at the top: earlier blocks reset the registry.
    const useUIStore = staticUIStore
    useUIStore.setState({
      updateReadyVersion: null,
      isUpdateInstalling: true,
      pendingUpdateVersion: '2.0.0',
      updateModalVersion: null,
    })
    vi.mocked(invoke).mockReset()
    vi.mocked(invoke).mockResolvedValue(undefined)
    return { useUIStore }
  }

  beforeEach(() => {
    // The shared test setup's localStorage stores nothing.
    const stored = new Map<string, string>()
    vi.spyOn(localStorage, 'getItem').mockImplementation(
      key => stored.get(key) ?? null
    )
    vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      stored.set(key, value)
    })
    updater.notify.mockReset()
  })

  it('shows a toast with Restart, not a modal', async () => {
    const { useUIStore } = await load()
    updater.success.mockReset()

    markAppUpdateReady('2.0.0')

    const state = useUIStore.getState()
    expect(state.updateModalVersion).toBeNull()
    expect(state.updateReadyVersion).toBe('2.0.0')
    expect(state.isUpdateInstalling).toBe(false)
    expect(state.pendingUpdateVersion).toBeNull()
    expect(updater.success).toHaveBeenCalledTimes(1)
    const [text, options] = updater.success.mock.calls[0] as unknown as [
      string,
      {
        id: string
        duration: number
        action: { label: string; onClick: () => void }
      },
    ]
    expect(text).toContain('2.0.0 is ready')
    expect(options.id).toBe(UPDATE_READY_TOAST_ID)
    expect(options.duration).toBe(Infinity)
    expect(options.action.label).toBe('Restart')

    // Restart takes the install-then-relaunch path, as Restart Now does.
    const install = vi.fn()
    window.addEventListener('install-pending-update', install)
    options.action.onClick()
    window.removeEventListener('install-pending-update', install)
    expect(install).toHaveBeenCalledTimes(1)
  })

  it('sends the native notification once per version', async () => {
    await load()

    markAppUpdateReady('2.0.0')
    markAppUpdateReady('2.0.0')
    expect(updater.notify).toHaveBeenCalledTimes(1)
    expect(updater.notify).toHaveBeenCalledWith(
      expect.stringContaining('2.0.0 is ready'),
      'Restart to install it.',
      { native: true }
    )

    markAppUpdateReady('2.0.1')
    expect(updater.notify).toHaveBeenCalledTimes(2)
  })

  it('adds "Restart to update" to the menu bar icon', async () => {
    await load()
    markAppUpdateReady('2.0.0')
    expect(invoke).toHaveBeenCalledWith('set_tray_update_ready', {
      version: '2.0.0',
    })
  })
})
