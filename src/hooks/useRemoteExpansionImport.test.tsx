import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProjectsStore } from '@/store/projects-store'

const { mockInvokeOnServer, snapshots } = vi.hoisted(() => ({
  mockInvokeOnServer: vi.fn(),
  snapshots: new Map<string, { status: string }>(),
}))

vi.mock('@/lib/environment', () => ({ aggregatesServers: () => true }))
vi.mock('@/lib/remote-connections', () => ({
  useRemoteConnections: () => [
    { id: 'mac-2', name: 'MAC-2' },
    { id: 'off', name: 'Off', enabled: false },
  ],
}))
vi.mock('@/lib/server-connections', () => ({
  invokeOnServer: mockInvokeOnServer,
  useServerConnectionSnapshots: () => snapshots,
}))

import {
  REMOTE_EXPANSION_IMPORTED_KEY,
  useRemoteExpansionImport,
} from './useRemoteExpansionImport'

describe('useRemoteExpansionImport', () => {
  const storage = new Map<string, string>()

  beforeEach(() => {
    vi.clearAllMocks()
    storage.clear()
    snapshots.clear()
    snapshots.set('mac-2', { status: 'online' })
    snapshots.set('off', { status: 'online' })
    vi.mocked(localStorage.getItem).mockImplementation(
      key => storage.get(key) ?? null
    )
    vi.mocked(localStorage.setItem).mockImplementation((key, value) => {
      storage.set(key, value)
    })
    mockInvokeOnServer.mockResolvedValue({
      expanded_project_ids: ['p1'],
      expanded_folder_ids: ['f1'],
      expanded_worktree_ids: ['w1'],
    })
    useProjectsStore.setState({
      expandedProjectIds: new Set(['local-project']),
      expandedFolderIds: new Set(),
      expandedWorktreeIds: new Set(),
    })
  })

  it('adds a remote saved expansion under server-scoped ids, once', async () => {
    const { rerender } = renderHook(() => useRemoteExpansionImport(true))

    await waitFor(() =>
      expect(storage.get(REMOTE_EXPANSION_IMPORTED_KEY)).toBe('["mac-2"]')
    )
    const state = useProjectsStore.getState()
    expect([...state.expandedProjectIds]).toEqual(['local-project', 'mac-2:p1'])
    expect([...state.expandedFolderIds]).toEqual(['mac-2:f1'])
    expect([...state.expandedWorktreeIds]).toEqual(['mac-2:w1'])
    expect(mockInvokeOnServer).toHaveBeenCalledTimes(1)
    expect(mockInvokeOnServer).toHaveBeenCalledWith('mac-2', 'load_ui_state')

    rerender()
    renderHook(() => useRemoteExpansionImport(true))
    expect(mockInvokeOnServer).toHaveBeenCalledTimes(1)
  })

  it('waits for the UI state to be restored and for the remote to be online', async () => {
    snapshots.set('mac-2', { status: 'connecting' })
    renderHook(() => useRemoteExpansionImport(true))
    renderHook(() => useRemoteExpansionImport(false))
    await Promise.resolve()
    expect(mockInvokeOnServer).not.toHaveBeenCalled()
  })

  it('retries later when the remote cannot answer', async () => {
    mockInvokeOnServer.mockRejectedValueOnce(new Error('offline'))
    renderHook(() => useRemoteExpansionImport(true))
    await waitFor(() => expect(mockInvokeOnServer).toHaveBeenCalledTimes(1))
    await Promise.resolve()
    expect(storage.has(REMOTE_EXPANSION_IMPORTED_KEY)).toBe(false)
  })
})
