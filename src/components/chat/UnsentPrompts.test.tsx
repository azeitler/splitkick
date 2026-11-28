import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  reason: null as null | 'backend' | 'models',
  footerShown: true,
}))

vi.mock('@/components/layout/OfflineIndicator', () => ({
  OFFLINE_TEXT: {
    backend: 'Offline. Reconnecting…',
    models: 'No internet. The models cannot be reached.',
  },
  useOfflineReason: () => state.reason,
  useSidebarFooterShown: () => state.footerShown,
}))

import { useChatStore } from '@/store/chat-store'
import { useOutboxStore, type OutboxEntry } from '@/lib/prompt-outbox'
import type { QueuedMessage } from '@/types/chat'
import { UnsentPrompts } from './UnsentPrompts'

function entry(overrides: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    id: 'p1',
    sessionId: 's1',
    worktreeId: 'w1',
    worktreePath: '/tmp/w1',
    text: 'Add the settings field',
    message: 'Add the settings field',
    createdAt: Date.now() - 120_000,
    status: 'unsent',
    ...overrides,
  }
}

function setEntries(...entries: OutboxEntry[]) {
  act(() => {
    useOutboxStore.setState({
      entries: Object.fromEntries(entries.map(e => [e.id, e])),
      inFlight: {},
    })
  })
}

describe('UnsentPrompts', () => {
  const onSendAgain = vi.fn()

  beforeEach(() => {
    onSendAgain.mockClear()
    state.reason = null
    state.footerShown = true
    localStorage.clear()
    useOutboxStore.setState({ entries: {}, inFlight: {} })
    useChatStore.setState({ inputDrafts: {} })
  })

  it('renders nothing when the session has no unsent prompt and is online', () => {
    setEntries(
      entry({ sessionId: 'other' }),
      entry({ id: 'p2', status: 'pending' })
    )
    const { container } = render(
      <UnsentPrompts sessionId="s1" onSendAgain={onSendAgain} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('shows an unsent prompt with its text, age and attachment count', () => {
    setEntries(
      entry({
        queued: {
          pendingImages: [{}, {}],
          pendingFiles: [{}],
          pendingSkills: [],
          pendingTextFiles: [],
        } as unknown as QueuedMessage,
      })
    )
    render(<UnsentPrompts sessionId="s1" onSendAgain={onSendAgain} />)

    const item = screen.getByTestId('unsent-prompt')
    expect(item).toHaveTextContent('Unsent message')
    expect(item).toHaveTextContent('Add the settings field')
    expect(item).toHaveTextContent('2m ago')
    expect(item).toHaveTextContent('3 attachments')
  })

  it('lists the unsent prompts of this session only, oldest first', () => {
    setEntries(
      entry({ id: 'new', text: 'Second', createdAt: Date.now() - 1000 }),
      entry({ id: 'old', text: 'First', createdAt: Date.now() - 9000 }),
      entry({ id: 'x', sessionId: 'other', text: 'Elsewhere' }),
      entry({ id: 'r', text: 'Back in the input', status: 'restored' })
    )
    render(<UnsentPrompts sessionId="s1" onSendAgain={onSendAgain} />)

    const texts = screen
      .getAllByTestId('unsent-prompt')
      .map(item => item.querySelector('p')?.textContent)
    expect(texts).toEqual(['First', 'Second'])
  })

  it('"Send again" hands the entry to the chat window', () => {
    const unsent = entry()
    setEntries(unsent)
    render(<UnsentPrompts sessionId="s1" onSendAgain={onSendAgain} />)

    fireEvent.click(screen.getByRole('button', { name: 'Send again' }))

    expect(onSendAgain).toHaveBeenCalledWith(unsent)
  })

  // A send cannot reach the backend; the models case can still be tried.
  it('disables "Send again" only while the backend is offline', () => {
    setEntries(entry())
    state.reason = 'backend'
    const { rerender } = render(
      <UnsentPrompts sessionId="s1" onSendAgain={onSendAgain} />
    )
    expect(screen.getByRole('button', { name: 'Send again' })).toBeDisabled()

    // The component is memoized and the mocked hooks are not reactive: a
    // store change below makes it render again.
    state.reason = 'models'
    rerender(<UnsentPrompts sessionId="s1" onSendAgain={onSendAgain} />)
    setEntries(entry({ text: 'Add the settings field.' }))
    expect(screen.getByRole('button', { name: 'Send again' })).toBeEnabled()
  })

  it('"Edit" moves the prompt into the empty input and takes the item away', () => {
    setEntries(entry())
    render(<UnsentPrompts sessionId="s1" onSendAgain={onSendAgain} />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    expect(useChatStore.getState().inputDrafts.s1).toBe(
      'Add the settings field'
    )
    expect(useOutboxStore.getState().entries.p1?.status).toBe('restored')
    expect(screen.queryByTestId('unsent-prompt')).toBeNull()
  })

  it('"Edit" adds the prompt below text the user already typed', () => {
    useChatStore.setState({ inputDrafts: { s1: 'New thought' } })
    const appended = vi.fn()
    window.addEventListener('append-chat-input', appended)
    setEntries(entry())
    render(<UnsentPrompts sessionId="s1" onSendAgain={onSendAgain} />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    window.removeEventListener('append-chat-input', appended)
    expect(appended).toHaveBeenCalledTimes(1)
    expect((appended.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      text: '\nAdd the settings field',
    })
    // The typed text is not replaced.
    expect(useChatStore.getState().inputDrafts.s1).toBe('New thought')
  })

  // Nothing in the chat flow asks for confirmation.
  it('"Discard" removes the prompt at once', () => {
    setEntries(entry())
    render(<UnsentPrompts sessionId="s1" onSendAgain={onSendAgain} />)

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))

    expect(useOutboxStore.getState().entries.p1).toBeUndefined()
    expect(screen.queryByTestId('unsent-prompts')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  describe('the offline sign in the chat window', () => {
    it('shows where no sidebar footer shows it', () => {
      state.reason = 'backend'
      state.footerShown = false
      render(<UnsentPrompts sessionId="s1" onSendAgain={onSendAgain} />)

      expect(screen.getByTestId('offline-indicator')).toHaveTextContent(
        'Offline. Reconnecting…'
      )
    })

    it('stays out while the sidebar footer shows it', () => {
      state.reason = 'backend'
      state.footerShown = true
      const { container } = render(
        <UnsentPrompts sessionId="s1" onSendAgain={onSendAgain} />
      )
      expect(container).toBeEmptyDOMElement()
    })

    it('says that a message sent while offline is saved and will send', () => {
      state.reason = 'backend'
      state.footerShown = true
      setEntries(entry({ status: 'pending' }))
      render(<UnsentPrompts sessionId="s1" onSendAgain={onSendAgain} />)

      expect(screen.getByTestId('outbox-waiting')).toHaveTextContent(
        'Offline. Your message is saved and will send when the connection is back.'
      )
      // The footer already carries the sign.
      expect(screen.queryByTestId('offline-indicator')).toBeNull()
    })

    // Without internet a local send still reaches the backend.
    it('does not promise a later send when only the models are unreachable', () => {
      state.reason = 'models'
      state.footerShown = false
      setEntries(entry({ status: 'pending' }))
      render(<UnsentPrompts sessionId="s1" onSendAgain={onSendAgain} />)

      expect(screen.getByTestId('offline-indicator')).toHaveTextContent(
        'No internet. The models cannot be reached.'
      )
      expect(screen.queryByTestId('outbox-waiting')).toBeNull()
    })
  })
})
