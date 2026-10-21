import { describe, expect, it, vi } from 'vitest'
import {
  installAndRelaunch,
  resolveInstallPendingAction,
  shouldOfferUpdateCheck,
} from './app-update'

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
