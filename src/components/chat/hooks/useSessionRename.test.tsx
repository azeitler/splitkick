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
  })

  function setup() {
    return renderHook(() => useSessionRename())
  }

  // The menu calls onRename only after it has closed, so there is nothing to
  // wait for (azeitler/jean#29).
  it('opens the input at once and seeds the current name', () => {
    const { result } = setup()

    act(() => result.current.startRename(target))
    expect(result.current.renameValue).toBe('Investigation')
    expect(result.current.renamingSessionId).toBe('s-1')
  })

  it('renames with the target captured at start', () => {
    const { result } = setup()

    act(() => result.current.startRename(target))
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

    act(() => result.current.startRename(target))
    act(() => result.current.setRenameValue('   '))
    act(() => result.current.submitRename())
    expect(renameMutate).not.toHaveBeenCalled()

    act(() => result.current.startRename(target))
    act(() => result.current.submitRename())
    expect(renameMutate).not.toHaveBeenCalled()
  })

  // The row may have been renamed elsewhere since the menu opened.
  it('compares against the live name when one is passed', () => {
    const { result } = setup()

    act(() => result.current.startRename(target))
    act(() => result.current.setRenameValue('Renamed'))
    act(() => result.current.submitRename('Renamed'))

    expect(renameMutate).not.toHaveBeenCalled()
  })

  it('cancels on Escape and commits on Enter', () => {
    const { result } = setup()
    const key = (k: string) =>
      ({ key: k, preventDefault: vi.fn() }) as unknown as React.KeyboardEvent

    act(() => result.current.startRename(target))
    act(() => result.current.setRenameValue('Renamed'))
    act(() => result.current.handleRenameKeyDown(key('Escape')))
    expect(renameMutate).not.toHaveBeenCalled()
    expect(result.current.renamingSessionId).toBeNull()

    act(() => result.current.startRename(target))
    act(() => result.current.setRenameValue('Renamed'))
    act(() => result.current.handleRenameKeyDown(key('Enter')))
    expect(renameMutate).toHaveBeenCalledTimes(1)
  })

  const blur = (relatedTarget: Element | null) =>
    ({ relatedTarget }) as unknown as React.FocusEvent

  it('commits when focus moves somewhere other than a menu', () => {
    const { result } = setup()

    act(() => result.current.startRename(target))
    act(() => result.current.setRenameValue('Renamed'))
    act(() => result.current.handleRenameBlur(blur(document.body)))

    expect(renameMutate).toHaveBeenCalledTimes(1)
  })

  // A long-press or the menu key opens a menu, which takes focus. That is not
  // a decision to save the half-typed name.
  it('cancels instead of committing when focus moves into a menu', () => {
    const { result } = setup()
    const menu = document.createElement('div')
    menu.setAttribute('role', 'menu')
    const item = document.createElement('div')
    menu.appendChild(item)

    act(() => result.current.startRename(target))
    act(() => result.current.setRenameValue('Half-typ'))
    act(() => result.current.handleRenameBlur(blur(item)))

    expect(renameMutate).not.toHaveBeenCalled()
    expect(result.current.renamingSessionId).toBeNull()
  })

  describe('right-click while renaming', () => {
    function rightClick(target: EventTarget, button = 2) {
      act(() => {
        target.dispatchEvent(
          new PointerEvent('pointerdown', { bubbles: true, button })
        )
      })
    }

    it('cancels on a right-click outside the input, and a later blur saves nothing', () => {
      const { result } = setup()
      const input = document.createElement('input')
      const elsewhere = document.createElement('button')
      document.body.append(input, elsewhere)

      act(() => result.current.startRename(target))
      act(() => result.current.renameInputRef(input))
      act(() => result.current.setRenameValue('Half-typ'))
      rightClick(elsewhere)

      expect(result.current.renamingSessionId).toBeNull()
      // The blur that follows the unmount must not resurrect the edit.
      act(() => result.current.handleRenameBlur(blur(elsewhere)))
      expect(renameMutate).not.toHaveBeenCalled()

      input.remove()
      elsewhere.remove()
    })

    // Right-click in the text field is how you paste; it must keep the edit.
    it('keeps the rename open on a right-click inside the input', () => {
      const { result } = setup()
      const input = document.createElement('input')
      document.body.append(input)

      act(() => result.current.startRename(target))
      act(() => result.current.renameInputRef(input))
      rightClick(input)

      expect(result.current.renamingSessionId).toBe('s-1')
      input.remove()
    })

    // closeOpenSessionContextMenus() dispatches a synthetic primary-button
    // pointerdown on document; it must not end a rename.
    it('ignores a primary-button pointerdown', () => {
      const { result } = setup()

      act(() => result.current.startRename(target))
      rightClick(document, 0)

      expect(result.current.renamingSessionId).toBe('s-1')
    })

    it('stops listening once the rename ends', () => {
      const { result } = setup()
      const removeSpy = vi.spyOn(document, 'removeEventListener')

      act(() => result.current.startRename(target))
      act(() => result.current.cancelRename())

      expect(removeSpy).toHaveBeenCalledWith(
        'pointerdown',
        expect.any(Function),
        true
      )
      removeSpy.mockRestore()
    })
  })
})
