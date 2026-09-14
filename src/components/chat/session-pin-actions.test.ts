import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProjectsStore } from '@/store/projects-store'
import { queryClient } from '@/lib/query-client'

const flushUIStateMock = vi.fn<() => Promise<void>>()
const toastErrorMock = vi.fn()

vi.mock('@/lib/ui-state-flush', () => ({
  flushUIState: () => flushUIStateMock(),
}))

vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}))

const { togglePinnedSession, toggleStarredSession } =
  await import('./session-pin-actions')

const target = {
  projectId: 'project-1',
  sessionId: 'session-a',
  worktreeId: 'worktree-1',
}

const star = {
  projectId: 'project-1',
  worktreeId: 'worktree-1',
  sessionId: 'session-a',
}

function pins() {
  return useProjectsStore.getState().projectCanvasSettings['project-1']
    ?.pinnedSessions
}

function stars() {
  return useProjectsStore.getState().starredSessions
}

describe('session pin and star actions', () => {
  beforeEach(() => {
    flushUIStateMock.mockReset()
    flushUIStateMock.mockResolvedValue(undefined)
    toastErrorMock.mockReset()
    useProjectsStore.setState({
      projectCanvasSettings: {},
      starredSessions: [],
    })
  })

  it('keeps the pin and stays quiet when the write succeeds', async () => {
    await togglePinnedSession({ ...target, isPinned: false })

    expect(pins()).toEqual([
      { sessionId: 'session-a', worktreeId: 'worktree-1' },
    ])
    expect(toastErrorMock).not.toHaveBeenCalled()
  })

  it('reverts the pin and reports the failure', async () => {
    flushUIStateMock.mockRejectedValue(new Error('os error 13'))

    await togglePinnedSession({ ...target, isPinned: false })

    expect(pins()).toEqual([])
    expect(toastErrorMock).toHaveBeenCalledWith('Failed to pin session', {
      description: 'os error 13',
    })
  })

  it('restores the pin when the unpin fails', async () => {
    useProjectsStore
      .getState()
      .pinSessionToProject('project-1', 'session-a', 'worktree-1')
    flushUIStateMock.mockRejectedValue('save_ui_state failed')

    await togglePinnedSession({ ...target, isPinned: true })

    expect(pins()).toEqual([
      { sessionId: 'session-a', worktreeId: 'worktree-1' },
    ])
    expect(toastErrorMock).toHaveBeenCalledWith('Failed to unpin session', {
      description: 'save_ui_state failed',
    })
  })

  it('reverts the star and reports the failure', async () => {
    flushUIStateMock.mockRejectedValue(new Error('disk full'))

    await toggleStarredSession({ ...target, isStarred: false })

    expect(stars()).toEqual([])
    expect(toastErrorMock).toHaveBeenCalledWith('Failed to star session', {
      description: 'disk full',
    })
  })

  it('restores the star when the unstar fails', async () => {
    useProjectsStore.getState().starSession(star)
    flushUIStateMock.mockRejectedValue(new Error('disk full'))

    await toggleStarredSession({ ...target, isStarred: true })

    expect(stars()).toEqual([star])
    expect(toastErrorMock).toHaveBeenCalledWith('Failed to unstar session', {
      description: 'disk full',
    })
  })

  // The web client reloads from disk after a drop, so the toast is noise.
  it('reverts without a toast on a WebSocket drop', async () => {
    flushUIStateMock.mockRejectedValue(new Error('WebSocket disconnected'))

    await togglePinnedSession({ ...target, isPinned: false })

    expect(pins()).toEqual([])
    expect(toastErrorMock).not.toHaveBeenCalled()
  })

  // A stale failure must not fight a newer intent, nor toast about it.
  it('leaves a superseded toggle alone', async () => {
    let rejectWrite: (error: Error) => void = () => undefined
    flushUIStateMock.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectWrite = reject
        })
    )

    const pending = togglePinnedSession({ ...target, isPinned: false })
    await vi.waitFor(() => expect(flushUIStateMock).toHaveBeenCalled())

    // The user unpins again before the first write comes back.
    useProjectsStore
      .getState()
      .unpinSessionFromProject('project-1', 'session-a')
    rejectWrite(new Error('os error 13'))
    await pending

    expect(pins()).toEqual([])
    expect(toastErrorMock).not.toHaveBeenCalled()
  })

  it('refreshes the all-sessions cache on star only', async () => {
    const invalidate = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockResolvedValue(undefined)

    await toggleStarredSession({ ...target, isStarred: false })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['all-sessions'] })

    invalidate.mockClear()
    await toggleStarredSession({ ...target, isStarred: true })
    expect(invalidate).not.toHaveBeenCalled()

    invalidate.mockRestore()
  })
})
