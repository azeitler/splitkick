import { createElement, type PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useTerminalStore } from '@/store/terminal-store'
import { useUIStore } from '@/store/ui-store'
import type { UIState } from '@/types/ui-state'

vi.mock('@/lib/environment', () => ({
  isNativeApp: () => true,
  isLocalBackend: () => true,
  hasBackend: () => true,
}))

const {
  mockInvoke,
  mockSaveUIState,
  mockUseUIState,
  mockUseSaveUIState,
  mockUseProjects,
} = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockSaveUIState: vi.fn(),
  mockUseUIState: vi.fn(),
  mockUseSaveUIState: vi.fn(),
  mockUseProjects: vi.fn(),
}))

vi.mock('@/lib/transport', () => ({ invoke: mockInvoke }))

vi.mock('@/services/ui-state', () => ({
  useUIState: mockUseUIState,
  useSaveUIState: mockUseSaveUIState,
  uiStateQueryKeys: { all: ['ui-state'], state: () => ['ui-state'] },
}))

vi.mock('@/services/projects', () => ({ useProjects: mockUseProjects }))

vi.mock('@/lib/terminal-instances', () => ({
  disposeTerminal: vi.fn().mockResolvedValue(undefined),
  disposePanelWorktreeTerminals: vi.fn(),
}))

import { useUIStatePersistence } from './useUIStatePersistence'

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: PropsWithChildren) {
    return createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

function renderPersistence() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return renderHook(() => useUIStatePersistence(), {
    wrapper: createWrapper(queryClient),
  })
}

/** Mount the hook and wait until it has hydrated and armed its subscriptions. */
async function mountInitialized() {
  const rendered = renderPersistence()
  await waitFor(() => {
    expect(rendered.result.current.isInitialized).toBe(true)
  })
  mockSaveUIState.mockClear()
  return rendered
}

function lastSavedActiveSessionIds() {
  const calls = mockSaveUIState.mock.calls
  return (calls[calls.length - 1]?.[0] as UIState).active_session_ids
}

describe('useUIStatePersistence — flushing the pending save', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockImplementation(async (command: string) => {
      if (command === 'get_active_terminals') return []
      if (command === 'load_ui_state') return { version: 1 } as UIState
      return undefined
    })
    mockUseUIState.mockReturnValue({
      data: { version: 1 } as UIState,
      isSuccess: true,
    })
    mockUseProjects.mockReturnValue({ data: [], isSuccess: true })
    mockUseSaveUIState.mockReturnValue({ mutate: mockSaveUIState })

    useTerminalStore.setState({
      terminals: {},
      activeTerminalIds: {},
      runningTerminals: new Set(),
      failedTerminals: new Set(),
      terminalVisible: false,
      terminalPanelOpen: {},
      modalTerminalOpen: {},
    })
    useUIStore.setState({ uiStateInitialized: false, zenMode: false })
    useProjectsStore.setState({
      expandedWorktreeIds: new Set<string>(),
      projectCanvasSettings: {},
    })
    useChatStore.setState({
      activeWorktreeId: null,
      activeWorktreePath: null,
      activeSessionIds: {},
      sessionWorktreeMap: {},
      lastOpenedPerProject: {},
    })
  })

  it('writes the last session switch when the window is closing', async () => {
    await mountInitialized()

    useChatStore
      .getState()
      .setActiveSession('worktree-1', 'session-1', { markOpened: false })
    expect(mockSaveUIState).not.toHaveBeenCalled()

    window.dispatchEvent(new Event('beforeunload'))

    expect(mockSaveUIState).toHaveBeenCalledTimes(1)
    expect(lastSavedActiveSessionIds()).toEqual({ 'worktree-1': 'session-1' })
  })

  it('writes the newest switch, not the one the timer captured', async () => {
    await mountInitialized()

    const chat = useChatStore.getState()
    chat.setActiveSession('worktree-1', 'session-1', { markOpened: false })
    chat.setActiveSession('worktree-1', 'session-2', { markOpened: false })

    window.dispatchEvent(new Event('pagehide'))

    expect(mockSaveUIState).toHaveBeenCalledTimes(1)
    expect(lastSavedActiveSessionIds()).toEqual({ 'worktree-1': 'session-2' })
  })

  it('does not save again when the delay elapses after a flush', async () => {
    await mountInitialized()

    useChatStore
      .getState()
      .setActiveSession('worktree-1', 'session-1', { markOpened: false })
    window.dispatchEvent(new Event('beforeunload'))
    expect(mockSaveUIState).toHaveBeenCalledTimes(1)

    await new Promise(resolve => setTimeout(resolve, 700))
    expect(mockSaveUIState).toHaveBeenCalledTimes(1)
  })

  it('saves nothing when there is no pending write', async () => {
    await mountInitialized()

    window.dispatchEvent(new Event('beforeunload'))

    expect(mockSaveUIState).not.toHaveBeenCalled()
  })

  it('flushes instead of cancelling when the hook unmounts', async () => {
    const { unmount } = await mountInitialized()

    useChatStore
      .getState()
      .setActiveSession('worktree-1', 'session-1', { markOpened: false })
    unmount()

    expect(mockSaveUIState).toHaveBeenCalledTimes(1)
    expect(lastSavedActiveSessionIds()).toEqual({ 'worktree-1': 'session-1' })
  })
})
