import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRef } from 'react'
import { useUIStore } from '@/store/ui-store'
import { ChatSearchBar } from './ChatSearchBar'

interface Msg {
  id: string
  text: string
}

const SESSION_A: Msg[] = [
  { id: 'a1', text: 'alpha one' },
  { id: 'a2', text: 'alpha two' },
  { id: 'a3', text: 'alpha three' },
]
const SESSION_B: Msg[] = [{ id: 'b1', text: 'beta only' }]

function Harness({ sessionId, msgs }: { sessionId: string; msgs: Msg[] }) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  return (
    <>
      <div ref={scrollContainerRef} data-testid="chat">
        {msgs.map(m => (
          <div key={m.id} data-message-anchor-id={m.id}>
            <p>{m.text}</p>
          </div>
        ))}
      </div>
      {/* ChatWindow keys the bar by session the same way. */}
      <ChatSearchBar
        key={sessionId}
        sessionId={sessionId}
        scrollContainerRef={scrollContainerRef}
      />
    </>
  )
}

let revealed: string[] = []

/** Let the debounce/throttle timers and the MutationObserver run. */
async function flush() {
  await act(async () => {
    await Promise.resolve()
  })
  act(() => {
    vi.advanceTimersByTime(200)
  })
}

async function searchFor(text: string) {
  const input = screen.getByPlaceholderText('Find in chat...')
  fireEvent.change(input, { target: { value: text } })
  await flush()
  return input
}

describe('ChatSearchBar', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    revealed = []
    useUIStore.setState({ chatSearchBySession: {} })
    useUIStore.getState().openChatSearch('A')
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      callback(0)
      return 0
    })
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
      revealed.push(this.textContent ?? '')
    }
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    // @ts-expect-error jsdom has no scrollIntoView; remove the test stub
    delete Element.prototype.scrollIntoView
  })

  it('closes when Escape is pressed from the focused search input', () => {
    render(<Harness sessionId="A" msgs={SESSION_A} />)

    const input = screen.getByPlaceholderText('Find in chat...')
    input.focus()

    fireEvent.keyDown(input, { key: 'Escape' })

    expect(
      screen.queryByPlaceholderText('Find in chat...')
    ).not.toBeInTheDocument()
    expect(useUIStore.getState().chatSearchBySession.A).toBeUndefined()
  })

  it('closes when Escape is pressed from any focused search control', () => {
    render(<Harness sessionId="A" msgs={SESSION_A} />)

    const closeButton = screen.getByRole('button', { name: 'Close search' })
    closeButton.focus()

    fireEvent.keyDown(closeButton, { key: 'Escape' })

    expect(
      screen.queryByPlaceholderText('Find in chat...')
    ).not.toBeInTheDocument()
    expect(useUIStore.getState().chatSearchBySession.A).toBeUndefined()
  })

  it('steps to the next and previous match with Enter, Shift+Enter and arrows', async () => {
    render(<Harness sessionId="A" msgs={SESSION_A} />)
    const input = await searchFor('alpha')

    expect(screen.getByText('1/3')).toBeInTheDocument()
    expect(revealed).toEqual(['alpha one'])

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByText('2/3')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getByText('3/3')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(screen.getByText('2/3')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    // Wraps around from the first to the last match.
    expect(screen.getByText('3/3')).toBeInTheDocument()

    expect(revealed).toEqual([
      'alpha one',
      'alpha two',
      'alpha three',
      'alpha two',
      'alpha one',
      'alpha three',
    ])
  })

  it('keeps the current match and does not scroll while a turn streams', async () => {
    render(<Harness sessionId="A" msgs={SESSION_A} />)
    const input = await searchFor('alpha')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByText('2/3')).toBeInTheDocument()
    revealed = []

    // Streamed tokens: repeated DOM mutations, one of them a new match.
    const chat = screen.getByTestId('chat')
    const streaming = document.createElement('div')
    streaming.setAttribute('data-message-anchor-id', 'a4')
    chat.appendChild(streaming)
    for (const token of ['the ', 'alpha ', 'stream']) {
      streaming.append(document.createTextNode(token))
      await flush()
    }

    expect(screen.getByText('2/4')).toBeInTheDocument()
    expect(revealed).toEqual([])
  })

  it('keeps the same match when older messages are prepended', async () => {
    render(<Harness sessionId="A" msgs={SESSION_A} />)
    const input = await searchFor('alpha')
    fireEvent.keyDown(input, { key: 'Enter' })
    revealed = []

    const older = document.createElement('div')
    older.setAttribute('data-message-anchor-id', 'a0')
    older.textContent = 'alpha zero'
    screen.getByTestId('chat').prepend(older)
    await flush()

    // Still "alpha two", now the third match.
    expect(screen.getByText('3/4')).toBeInTheDocument()
    expect(revealed).toEqual([])
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(revealed).toEqual(['alpha three'])
  })

  it('keeps find-bar state per session and restores it on return', async () => {
    const { rerender } = render(<Harness sessionId="A" msgs={SESSION_A} />)
    const input = await searchFor('alpha')
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByText('3/3')).toBeInTheDocument()

    // Session B never opened the bar: it is hidden there.
    rerender(<Harness sessionId="B" msgs={SESSION_B} />)
    await flush()
    expect(
      screen.queryByPlaceholderText('Find in chat...')
    ).not.toBeInTheDocument()

    // Open and search in B; A keeps its own state.
    act(() => useUIStore.getState().openChatSearch('B'))
    await searchFor('beta')
    expect(screen.getByText('1/1')).toBeInTheDocument()
    expect(useUIStore.getState().chatSearchBySession.A).toMatchObject({
      query: 'alpha',
      activeIndex: 2,
    })

    // Back to A: same query, same current match, scrolled there once.
    revealed = []
    rerender(<Harness sessionId="A" msgs={SESSION_A} />)
    await flush()
    expect(screen.getByPlaceholderText('Find in chat...')).toHaveValue('alpha')
    expect(screen.getByText('3/3')).toBeInTheDocument()
    expect(revealed).toEqual(['alpha three'])

    await flush()
    expect(revealed).toEqual(['alpha three'])
  })

  it('closing clears only that session', async () => {
    useUIStore.getState().openChatSearch('B')
    render(<Harness sessionId="A" msgs={SESSION_A} />)
    await searchFor('alpha')

    fireEvent.click(screen.getByRole('button', { name: 'Close search' }))

    const state = useUIStore.getState().chatSearchBySession
    expect(state.A).toBeUndefined()
    expect(state.B).toBeDefined()
  })

  it('the shortcut event opens the bar for the displayed session only', () => {
    useUIStore.setState({ chatSearchBySession: {} })
    render(<Harness sessionId="B" msgs={SESSION_B} />)

    act(() => {
      window.dispatchEvent(new CustomEvent('chat-search-toggle'))
    })

    expect(screen.getByPlaceholderText('Find in chat...')).toBeInTheDocument()
    expect(Object.keys(useUIStore.getState().chatSearchBySession)).toEqual([
      'B',
    ])
  })
})
