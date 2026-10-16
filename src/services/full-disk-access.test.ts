import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  nativeApp: true,
  connectionId: 'local',
}))

vi.mock('@/lib/transport', () => ({ invoke: mocks.invoke }))
vi.mock('@/lib/environment', () => ({ isNativeApp: () => mocks.nativeApp }))
vi.mock('@/lib/remote-connections', () => ({
  LOCAL_CONNECTION_ID: 'local',
  getActiveConnectionId: () => mocks.connectionId,
}))

import {
  getFullDiskAccessStatus,
  openFullDiskAccessSettings,
  resetFullDiskAccessStatusForTests,
} from './full-disk-access'

describe('full-disk-access service', () => {
  beforeEach(() => {
    mocks.invoke.mockReset()
    mocks.nativeApp = true
    mocks.connectionId = 'local'
    resetFullDiskAccessStatusForTests()
  })

  it('probes once per app run and caches the result', async () => {
    mocks.invoke.mockResolvedValue('denied')

    expect(await getFullDiskAccessStatus()).toBe('denied')
    expect(await getFullDiskAccessStatus()).toBe('denied')
    expect(mocks.invoke).toHaveBeenCalledOnce()
    expect(mocks.invoke).toHaveBeenCalledWith('get_full_disk_access_status')
  })

  it('is not applicable in Web Access', async () => {
    mocks.nativeApp = false
    expect(await getFullDiskAccessStatus()).toBe('not_applicable')
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('is not applicable in a remote window', async () => {
    mocks.connectionId = 'remote-1'
    expect(await getFullDiskAccessStatus()).toBe('not_applicable')
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('hides the step when the probe fails', async () => {
    mocks.invoke.mockRejectedValue(new Error('Unknown command'))
    expect(await getFullDiskAccessStatus()).toBe('not_applicable')
  })

  it('opens System Settings through the backend', async () => {
    mocks.invoke.mockResolvedValue(undefined)
    await openFullDiskAccessSettings()
    expect(mocks.invoke).toHaveBeenCalledWith('open_full_disk_access_settings')
  })
})
