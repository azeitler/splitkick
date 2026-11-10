import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({ native: false }))
const saveWebDeviceView = vi.hoisted(() => vi.fn())
vi.mock('@/lib/environment', () => ({ isNativeApp: () => env.native }))
vi.mock('@/lib/web-device-view', () => ({ saveWebDeviceView }))

import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import {
  currentWebDeviceView,
  useWebDeviceViewPersistence,
} from './useWebDeviceViewPersistence'

describe('useWebDeviceViewPersistence', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    saveWebDeviceView.mockReset()
    env.native = false
    useProjectsStore.setState({ selectedProjectId: 'p1' })
    useChatStore.setState({
      activeWorktreeId: null,
      activeWorktreePath: null,
      activeSessionIds: { w1: 's1' },
      worktreePaths: { w1: '/repo/w1' },
    })
    useUIStore.setState({
      uiStateInitialized: true,
      sessionChatModalOpen: true,
      sessionChatModalWorktreeId: 'w1',
      mobileActiveTab: 'home',
      zenMode: false,
    })
  })

  afterEach(() => vi.useRealTimers())

  it('reads the open session modal and its session', () => {
    expect(currentWebDeviceView()).toEqual({
      projectId: 'p1',
      activeWorktreeId: null,
      activeWorktreePath: null,
      modalWorktreeId: 'w1',
      modalWorktreePath: '/repo/w1',
      activeSessionId: 's1',
      mobileTab: 'home',
      zenMode: false,
    })
  })

  it('waits for the restored UI state before it saves', () => {
    useUIStore.setState({ uiStateInitialized: false })
    renderHook(() => useWebDeviceViewPersistence())
    useProjectsStore.setState({ selectedProjectId: 'p2' })
    vi.advanceTimersByTime(1000)
    expect(saveWebDeviceView).not.toHaveBeenCalled()
  })

  it('saves during a stream of store changes, not only after it', () => {
    renderHook(() => useWebDeviceViewPersistence())
    expect(saveWebDeviceView).toHaveBeenCalledTimes(1)

    useProjectsStore.setState({ selectedProjectId: 'p2' })
    for (let i = 0; i < 10; i++) {
      useChatStore.setState({ inputDrafts: { s1: `draft ${i}` } })
      vi.advanceTimersByTime(100)
    }
    expect(saveWebDeviceView).toHaveBeenCalledTimes(2)
    expect(saveWebDeviceView).toHaveBeenLastCalledWith(
      expect.objectContaining({ projectId: 'p2' })
    )
  })

  it('saves at once when the page goes to the background', () => {
    renderHook(() => useWebDeviceViewPersistence())
    useUIStore.setState({ mobileActiveTab: 'history' })
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    })
    document.dispatchEvent(new Event('visibilitychange'))
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    })
    expect(saveWebDeviceView).toHaveBeenLastCalledWith(
      expect.objectContaining({ mobileTab: 'history' })
    )
  })

  it('does nothing in the native app', () => {
    env.native = true
    renderHook(() => useWebDeviceViewPersistence())
    vi.advanceTimersByTime(1000)
    expect(saveWebDeviceView).not.toHaveBeenCalled()
  })
})
