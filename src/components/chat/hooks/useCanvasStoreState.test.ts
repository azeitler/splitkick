import { describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useChatStore } from '@/store/chat-store'
import { useSessionsCardStoreState } from './useCanvasStoreState'

describe('useSessionsCardStoreState', () => {
  it('ignores changes to other sessions and follows its own', () => {
    let renders = 0
    const { result } = renderHook(() => {
      renders++
      return useSessionsCardStoreState(['mine'])
    })
    const first = result.current
    const rendersBefore = renders

    act(() => {
      useChatStore.setState(state => ({
        sendingSessionIds: { ...state.sendingSessionIds, other: true },
      }))
    })
    expect(renders).toBe(rendersBefore)
    expect(result.current).toBe(first)

    act(() => {
      useChatStore.setState(state => ({
        sendingSessionIds: { ...state.sendingSessionIds, mine: true },
      }))
    })
    expect(result.current).not.toBe(first)
    expect(result.current.sendingSessionIds.mine).toBe(true)
  })
})
