import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@/lib/transport'
import { logNativeError } from '@/lib/native-log'
import {
  RELEASE_IDENTIFIER,
  type AppUpdateGuardState,
  describeUpdateCheckFailure,
  installAndRelaunch,
  isUpdateCheckEnabled,
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
  loading: vi.fn(() => 'checking-toast'),
  dismiss: vi.fn(),
}))

vi.mock('@tauri-apps/api/app', () => ({
  getIdentifier: () => Promise.resolve(updater.identifier),
}))
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
  toast: { loading: updater.loading, dismiss: updater.dismiss },
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
    const { checkForUpdatesManually } = await load()
    await checkForUpdatesManually()
    expect(updater.check).not.toHaveBeenCalled()
    expect(updater.notify).toHaveBeenCalledWith(
      'Updates are off in development builds',
      undefined,
      { type: 'info' }
    )
  })

  it('asks for a restart when an update is ready', async () => {
    const { checkForUpdatesManually } = await load({
      updateReadyVersion: '1.2.3',
    })
    await checkForUpdatesManually()
    expect(updater.check).not.toHaveBeenCalled()
    expect(updater.notify).toHaveBeenCalledWith(
      'Update 1.2.3 is ready — restart to apply',
      undefined,
      { type: 'success' }
    )
  })

  it('does not check again while a download runs', async () => {
    const { checkForUpdatesManually } = await load({
      isUpdateInstalling: true,
    })
    await checkForUpdatesManually()
    expect(updater.check).not.toHaveBeenCalled()
    expect(updater.notify).toHaveBeenCalledWith(
      'Update download already in progress',
      undefined,
      { type: 'info' }
    )
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
    const { checkForUpdatesManually } = await load()
    await checkForUpdatesManually()
    expect(updater.notify).toHaveBeenCalledWith(
      'You are running the latest version',
      undefined,
      { type: 'success' }
    )
  })

  it('reports a failed check', async () => {
    updater.check.mockRejectedValue(new Error('offline'))
    vi.mocked(invoke).mockResolvedValue('could not reach github.com: timeout')
    const { checkForUpdatesManually } = await load()
    await checkForUpdatesManually()
    expect(updater.notify).toHaveBeenCalledWith(
      'Failed to check for updates: Error: offline (could not reach github.com: timeout)',
      undefined,
      { type: 'error' }
    )
  })
})
