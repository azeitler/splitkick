import { beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useIsHomeActive } from './useIsHomeActive'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'

describe('useIsHomeActive', () => {
  beforeEach(() => {
    useProjectsStore.getState().selectProject(null)
    useChatStore.getState().clearActiveWorktree()
  })

  it('is true while no project and no worktree is selected', () => {
    const { result } = renderHook(() => useIsHomeActive())
    expect(result.current).toBe(true)
  })

  it('is false once a project is selected', () => {
    const { result } = renderHook(() => useIsHomeActive())
    act(() => useProjectsStore.getState().selectProject('project-1'))
    expect(result.current).toBe(false)
  })

  it('is false while a worktree is open, even with no project selected', () => {
    const { result } = renderHook(() => useIsHomeActive())
    act(() =>
      useChatStore.getState().setActiveWorktree('worktree-1', '/tmp/wt')
    )
    expect(result.current).toBe(false)
  })

  it('turns true again when the Home row clears both', () => {
    useProjectsStore.getState().selectProject('project-1')
    const { result } = renderHook(() => useIsHomeActive())

    act(() => {
      useProjectsStore.getState().selectProject(null)
      useChatStore.getState().clearActiveWorktree()
    })
    expect(result.current).toBe(true)
  })
})
