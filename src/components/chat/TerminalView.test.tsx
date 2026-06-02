import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, waitFor } from '@/test/test-utils'
import { useTerminalStore } from '@/store/terminal-store'
import { SingleTerminalView } from './TerminalView'

const initTerminal = vi.fn().mockResolvedValue(undefined)
const fit = vi.fn()
const focus = vi.fn()

vi.mock('@/hooks/useTerminal', () => ({
  useTerminal: () => ({
    initTerminal,
    fit,
    focus,
  }),
}))

class ResizeObserverMock {
  observe = vi.fn()
  disconnect = vi.fn()
}

describe('SingleTerminalView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.ResizeObserver =
      ResizeObserverMock as unknown as typeof ResizeObserver
    window.requestAnimationFrame =
      window.requestAnimationFrame ??
      ((callback: FrameRequestCallback) => {
        callback(0)
        return 0
      })
    useTerminalStore.setState({
      terminals: {
        'worktree-1': [
          {
            id: 'terminal-1',
            worktreeId: 'worktree-1',
            command: 'codex',
            commandArgs: [],
            label: 'Codex',
            kind: 'session',
          },
          {
            id: 'terminal-2',
            worktreeId: 'worktree-1',
            command: 'claude',
            commandArgs: [],
            label: 'Claude',
            kind: 'session',
          },
        ],
      },
      activeTerminalIds: {},
      runningTerminals: new Set(),
      failedTerminals: new Set(),
      terminalVisible: false,
      terminalPanelOpen: {},
      modalTerminalOpen: {},
    })
  })

  it('does not initialize inactive full-screen terminal sessions', () => {
    render(
      <SingleTerminalView
        terminalId="terminal-1"
        worktreeId="worktree-1"
        worktreePath="/tmp/worktree-1"
        isActive={false}
      />
    )

    expect(initTerminal).not.toHaveBeenCalled()
  })

  it('initializes when the full-screen terminal becomes active', async () => {
    const { rerender } = render(
      <SingleTerminalView
        terminalId="terminal-1"
        worktreeId="worktree-1"
        worktreePath="/tmp/worktree-1"
        isActive={false}
      />
    )

    rerender(
      <SingleTerminalView
        terminalId="terminal-1"
        worktreeId="worktree-1"
        worktreePath="/tmp/worktree-1"
        isActive
      />
    )

    await waitFor(() => expect(initTerminal).toHaveBeenCalledTimes(1))
  })

  it('initializes the new terminal when switching full-screen session terminals', async () => {
    const { rerender } = render(
      <SingleTerminalView
        terminalId="terminal-1"
        worktreeId="worktree-1"
        worktreePath="/tmp/worktree-1"
        isActive
      />
    )

    await waitFor(() => expect(initTerminal).toHaveBeenCalledTimes(1))

    rerender(
      <SingleTerminalView
        terminalId="terminal-2"
        worktreeId="worktree-1"
        worktreePath="/tmp/worktree-1"
        isActive
      />
    )

    await waitFor(() => expect(initTerminal).toHaveBeenCalledTimes(2))
  })
})
