import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import { openHome, useIsHomeNavActive } from './home-nav'

describe('home navigation', () => {
  beforeEach(() => {
    useProjectsStore.getState().selectProject(null)
    useChatStore.getState().clearActiveWorktree()
    useUIStore.setState({
      archivedViewOpen: false,
      scheduledViewOpen: false,
      activeGraphId: null,
    })
  })

  it('opens Home: clears the project, the worktree and the pages over it', () => {
    useProjectsStore.getState().selectProject('project-1')
    useChatStore.getState().setActiveWorktree('worktree-1', '/tmp/wt')
    useUIStore.setState({ archivedViewOpen: true, scheduledViewOpen: true })

    openHome()

    expect(useProjectsStore.getState().selectedProjectId).toBeNull()
    expect(useChatStore.getState().activeWorktreeId).toBeNull()
    expect(useUIStore.getState().archivedViewOpen).toBe(false)
    expect(useUIStore.getState().scheduledViewOpen).toBe(false)
  })

  it('is active only while nothing else is selected or open', () => {
    expect(renderHook(() => useIsHomeNavActive()).result.current).toBe(true)

    useProjectsStore.getState().selectProject('project-1')
    expect(renderHook(() => useIsHomeNavActive()).result.current).toBe(false)

    useProjectsStore.getState().selectProject(null)
    useUIStore.setState({ archivedViewOpen: true })
    expect(renderHook(() => useIsHomeNavActive()).result.current).toBe(false)
  })
})
