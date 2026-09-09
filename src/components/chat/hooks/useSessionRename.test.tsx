import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionRename } from './useSessionRename'

const renameMutate = vi.fn()

vi.mock('@/services/chat', async importOriginal => ({
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  ...(await importOriginal<typeof import('@/services/chat')>()),
  useRenameSession: () => ({ mutate: renameMutate }),
}))

const target = {
  sessionId: 's-1',
  worktreeId: 'wt-1',
  worktreePath: '/tmp/wt-1',
  currentName: 'Investigation',
}

describe('useSessionRename', () => {
  beforeEach(() => {
    renameMutate.mockClear()
    vi.useFakeTimers()
  })

  function setup() {
    return renderHook(() => useSessionRename())
  }

  // The context menu keeps focus until it closes, so the input mounts late.
  it('waits before it opens the input, and seeds the current name', () => {
    const { result } = setup()

    act(() => result.current.startRename(target))
    expect(result.current.renameValue).toBe('Investigation')
    expect(result.current.renamingSessionId).toBeNull()

    act(() => void vi.advanceTimersByTime(200))
    expect(result.current.renamingSessionId).toBe('s-1')
  })

  it('opens the input at once when started immediately', () => {
    const { result } = setup()

    act(() => result.current.startRenameImmediate(target))
    expect(result.current.renamingSessionId).toBe('s-1')
  })

  it('renames with the target captured at start', () => {
    const { result } = setup()

    act(() => result.current.startRenameImmediate(target))
    act(() => result.current.setRenameValue('  Renamed  '))
    act(() => result.current.submitRename())

    expect(renameMutate).toHaveBeenCalledWith({
      worktreeId: 'wt-1',
      worktreePath: '/tmp/wt-1',
      sessionId: 's-1',
      newName: 'Renamed',
    })
    expect(result.current.renamingSessionId).toBeNull()
  })

  it('skips an empty or unchanged name', () => {
    const { result } = setup()

    act(() => result.current.startRenameImmediate(target))
    act(() => result.current.setRenameValue('   '))
    act(() => result.current.submitRename())
    expect(renameMutate).not.toHaveBeenCalled()

    act(() => result.current.startRenameImmediate(target))
    act(() => result.current.submitRename())
    expect(renameMutate).not.toHaveBeenCalled()
  })

  // The row may have been renamed elsewhere since the menu opened.
  it('compares against the live name when one is passed', () => {
    const { result } = setup()

    act(() => result.current.startRenameImmediate(target))
    act(() => result.current.setRenameValue('Renamed'))
    act(() => result.current.submitRename('Renamed'))

    expect(renameMutate).not.toHaveBeenCalled()
  })

  it('cancels on Escape and commits on Enter', () => {
    const { result } = setup()
    const key = (k: string) =>
      ({ key: k, preventDefault: vi.fn() }) as unknown as React.KeyboardEvent

    act(() => result.current.startRenameImmediate(target))
    act(() => result.current.setRenameValue('Renamed'))
    act(() => result.current.handleRenameKeyDown(key('Escape')))
    expect(renameMutate).not.toHaveBeenCalled()
    expect(result.current.renamingSessionId).toBeNull()

    act(() => result.current.startRenameImmediate(target))
    act(() => result.current.setRenameValue('Renamed'))
    act(() => result.current.handleRenameKeyDown(key('Enter')))
    expect(renameMutate).toHaveBeenCalledTimes(1)
  })

  // An archived or unpinned row unmounts without a blur, so the pending timer
  // must not fire into a dead component.
  it('drops the pending start timer on unmount', () => {
    const { result, unmount } = setup()

    act(() => result.current.startRename(target))
    unmount()

    expect(() => vi.advanceTimersByTime(200)).not.toThrow()
  })
})
