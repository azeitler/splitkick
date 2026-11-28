import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const net = vi.hoisted(() => ({ offline: false }))
const outbox = vi.hoisted(() => ({
  recoverOutbox: vi.fn(async () => undefined),
  noteInputDraftChanged: vi.fn(),
}))

vi.mock('@/lib/backend-online', () => ({
  useBackendOffline: () => net.offline,
  isBackendOffline: () => net.offline,
}))

vi.mock('@/lib/prompt-outbox', async importOriginal => ({
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  ...(await importOriginal<typeof import('@/lib/prompt-outbox')>()),
  recoverOutbox: outbox.recoverOutbox,
  noteInputDraftChanged: outbox.noteInputDraftChanged,
}))

import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'
import { useOutboxStore, type OutboxEntry } from '@/lib/prompt-outbox'
import { usePromptOutboxRecovery } from './usePromptOutboxRecovery'

const pending: OutboxEntry = {
  id: 'p1',
  sessionId: 's1',
  worktreeId: 'w1',
  worktreePath: '/tmp/w1',
  text: 'Add the settings field',
  message: 'Add the settings field',
  createdAt: 1,
  status: 'pending',
}

describe('usePromptOutboxRecovery', () => {
  beforeEach(() => {
    outbox.recoverOutbox.mockClear()
    outbox.noteInputDraftChanged.mockClear()
    net.offline = false
    localStorage.clear()
    useOutboxStore.setState({ entries: { p1: pending }, inFlight: {} })
    useChatStore.setState({ inputDrafts: {} })
    useUIStore.setState({ uiStateInitialized: true })
  })

  // After a reload: the prompt of the last visit is checked against the backend.
  it('checks unconfirmed prompts once the saved UI state is loaded', () => {
    renderHook(() => usePromptOutboxRecovery())
    expect(outbox.recoverOutbox).toHaveBeenCalledTimes(1)
  })

  it('does nothing while the outbox is empty', () => {
    useOutboxStore.setState({ entries: {}, inFlight: {} })
    renderHook(() => usePromptOutboxRecovery())
    expect(outbox.recoverOutbox).not.toHaveBeenCalled()
  })

  // The saved UI state brings back the input drafts; a restore before that
  // would be overwritten.
  it('waits for the saved UI state', () => {
    useUIStore.setState({ uiStateInitialized: false })
    renderHook(() => usePromptOutboxRecovery())
    expect(outbox.recoverOutbox).not.toHaveBeenCalled()

    act(() => useUIStore.setState({ uiStateInitialized: true }))
    expect(outbox.recoverOutbox).toHaveBeenCalledTimes(1)
  })

  it('waits while the backend is offline, and checks when it is back', () => {
    net.offline = true
    const { rerender } = renderHook(() => usePromptOutboxRecovery())
    expect(outbox.recoverOutbox).not.toHaveBeenCalled()

    net.offline = false
    rerender()
    expect(outbox.recoverOutbox).toHaveBeenCalledTimes(1)
  })

  // A call that just failed leaves the in-flight set: check that prompt now.
  it('checks again when a call for a prompt ends', () => {
    useOutboxStore.setState({ inFlight: { p1: true } })
    renderHook(() => usePromptOutboxRecovery())
    outbox.recoverOutbox.mockClear()

    act(() => useOutboxStore.setState({ inFlight: {} }))
    expect(outbox.recoverOutbox).toHaveBeenCalledTimes(1)
  })

  describe('edits of the input', () => {
    it('reports a changed draft of a session that has an outbox entry', () => {
      renderHook(() => usePromptOutboxRecovery())

      act(() => useChatStore.getState().setInputDraft('s1', 'typed'))

      expect(outbox.noteInputDraftChanged).toHaveBeenCalledWith(
        's1',
        'typed',
        true
      )
    })

    it('says so when the edit happens offline', () => {
      net.offline = true
      renderHook(() => usePromptOutboxRecovery())

      act(() => useChatStore.getState().setInputDraft('s1', 'typed'))

      expect(outbox.noteInputDraftChanged).toHaveBeenCalledWith(
        's1',
        'typed',
        false
      )
    })

    it('ignores the drafts of sessions without an outbox entry', () => {
      renderHook(() => usePromptOutboxRecovery())

      act(() => useChatStore.getState().setInputDraft('other', 'typed'))

      expect(outbox.noteInputDraftChanged).not.toHaveBeenCalled()
    })

    // The hydration replaces the drafts; that is not an edit by the user.
    it('ignores draft changes before the saved UI state is loaded', () => {
      useUIStore.setState({ uiStateInitialized: false })
      renderHook(() => usePromptOutboxRecovery())

      act(() => useChatStore.getState().setInputDraft('s1', 'from disk'))

      expect(outbox.noteInputDraftChanged).not.toHaveBeenCalled()
    })

    it('stops listening when it unmounts', () => {
      const { unmount } = renderHook(() => usePromptOutboxRecovery())
      unmount()

      act(() => useChatStore.getState().setInputDraft('s1', 'typed'))

      expect(outbox.noteInputDraftChanged).not.toHaveBeenCalled()
    })
  })
})
