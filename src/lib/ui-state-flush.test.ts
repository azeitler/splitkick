import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/store/ui-store'
import { useProjectsStore } from '@/store/projects-store'
import type { UIState } from '@/types/ui-state'

const saveUIStateNowMock = vi.fn<(uiState: UIState) => Promise<void>>()

vi.mock('@/services/ui-state', () => ({
  saveUIStateNow: (uiState: UIState) => saveUIStateNowMock(uiState),
}))

const { flushUIState } = await import('./ui-state-flush')

describe('flushUIState', () => {
  beforeEach(() => {
    saveUIStateNowMock.mockReset()
    saveUIStateNowMock.mockResolvedValue(undefined)
    useProjectsStore.setState({ starredSessions: [] })
    useUIStore.setState({ uiStateInitialized: true })
  })

  // Writing default stores over the real file would drop pins, stars and drafts.
  it('writes nothing before hydration finished', async () => {
    useUIStore.setState({ uiStateInitialized: false })

    await expect(flushUIState()).resolves.toBeUndefined()
    expect(saveUIStateNowMock).not.toHaveBeenCalled()
  })

  it('rejects with the write failure so the caller can revert', async () => {
    saveUIStateNowMock.mockRejectedValueOnce(new Error('os error 13'))

    await expect(flushUIState()).rejects.toThrow('os error 13')
  })

  it('keeps working after a failed write', async () => {
    saveUIStateNowMock.mockRejectedValueOnce(new Error('os error 13'))

    await expect(flushUIState()).rejects.toThrow('os error 13')
    await expect(flushUIState()).resolves.toBeUndefined()
    expect(saveUIStateNowMock).toHaveBeenCalledTimes(2)
  })

  // Two writes at once could land out of order and undo the newer toggle.
  it('serializes writes and snapshots at write time, not at call time', async () => {
    let releaseFirst: () => void = () => undefined
    saveUIStateNowMock.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          releaseFirst = resolve
        })
    )

    const first = flushUIState()
    const second = flushUIState()

    // The chain starts on a microtask, so let the first write begin.
    await vi.waitFor(() => expect(saveUIStateNowMock).toHaveBeenCalledTimes(1))

    // A change made while the first write is in flight belongs to the second.
    useProjectsStore.setState({
      starredSessions: [
        {
          projectId: 'project-1',
          worktreeId: 'worktree-1',
          sessionId: 'session-a',
        },
      ],
    })
    releaseFirst()
    await Promise.all([first, second])

    expect(saveUIStateNowMock).toHaveBeenCalledTimes(2)
    const [firstWrite, secondWrite] = saveUIStateNowMock.mock.calls
    expect(firstWrite?.[0].starred_sessions).toEqual([])
    expect(secondWrite?.[0].starred_sessions).toEqual([
      {
        project_id: 'project-1',
        worktree_id: 'worktree-1',
        session_id: 'session-a',
      },
    ])
  })
})
