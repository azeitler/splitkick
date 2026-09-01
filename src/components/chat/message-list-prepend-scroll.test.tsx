import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@/test/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CompactMessageList } from './CompactMessageList'
import { VirtualizedMessageList } from './VirtualizedMessageList'
import type {
  ChatMessage,
  Question,
  QuestionAnswer,
  ReviewFinding,
} from '@/types/chat'

vi.mock('./MessageItem', () => ({
  MessageItem: ({ message }: { message: ChatMessage }) => (
    <div>{message.content}</div>
  ),
}))

const noopQuestionAnswer = (
  _toolCallId: string,
  _answers: QuestionAnswer[],
  _questions: Question[]
) => undefined

const noopFixFinding = async (_finding: ReviewFinding, _suggestion?: string) =>
  undefined

const noopFixAllFindings = async (
  _findings: { finding: ReviewFinding; suggestion?: string }[]
) => undefined

function message(id: string, content = id): ChatMessage {
  return {
    id,
    session_id: 'session-1',
    role: id.startsWith('user') ? 'user' : 'assistant',
    content,
    timestamp: 100,
    tool_calls: [],
    content_blocks: [{ type: 'text', text: content }],
  }
}

const baseProps = {
  totalMessages: 2,
  lastPlanMessageIndex: -1,
  sessionId: 'session-1',
  worktreePath: '/tmp/worktree',
  approveShortcut: 'Cmd+Enter',
  isSending: false,
  onPlanApproval: vi.fn(),
  onQuestionAnswer: noopQuestionAnswer,
  onQuestionSkip: vi.fn(),
  onFileClick: vi.fn(),
  onFixFinding: noopFixFinding,
  onFixAllFindings: noopFixAllFindings,
  isQuestionAnswered: vi.fn(() => false),
  getSubmittedAnswers: vi.fn(() => undefined),
  areQuestionsSkipped: vi.fn(() => false),
  isFindingFixed: vi.fn(() => false),
}

const originalGetBoundingClientRect =
  HTMLElement.prototype.getBoundingClientRect
let rectTopByMessageId = new Map<string, number>()

function rect(top: number, bottom: number): DOMRect {
  return {
    top,
    bottom,
    left: 0,
    right: 100,
    width: 100,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect
}

beforeEach(() => {
  rectTopByMessageId = new Map()
  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.getAttribute('data-testid') === 'scroll-container') {
      return rect(100, 500)
    }
    const messageId = this.dataset.messageAnchorId
    if (messageId && rectTopByMessageId.has(messageId)) {
      const top = rectTopByMessageId.get(messageId) ?? 0
      return rect(top, top + 80)
    }
    return originalGetBoundingClientRect.call(this)
  }
})

afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect
})

function ScrollContainer({ children }: { children: ReactNode }) {
  return (
    <div data-testid="scroll-container" style={{ height: 400 }}>
      {children}
    </div>
  )
}

describe('older message prepend scroll restoration', () => {
  it('keeps the same normal-list message at the same viewport offset after loading older runs', () => {
    const scrollContainerRef = { current: null as HTMLDivElement | null }
    const onLoadOlderRuns = vi.fn()
    const currentMessages = [
      message('user-current'),
      message('assistant-current'),
    ]

    const { rerender } = render(
      <ScrollContainer>
        <VirtualizedMessageList
          {...baseProps}
          messages={currentMessages}
          scrollContainerRef={scrollContainerRef}
          totalMessages={currentMessages.length}
          hasOlderOnDisk
          onLoadOlderRuns={onLoadOlderRuns}
          loadedRunStartIndex={1}
        />
      </ScrollContainer>
    )
    const container = screen.getByTestId('scroll-container') as HTMLDivElement
    scrollContainerRef.current = container
    container.scrollTop = 250
    rectTopByMessageId.set('user-current', 140)
    rectTopByMessageId.set('assistant-current', 230)

    fireEvent.click(
      screen.getByRole('button', { name: /load older messages/i })
    )

    expect(onLoadOlderRuns).toHaveBeenCalledTimes(1)

    rectTopByMessageId.set('user-current', 360)
    rectTopByMessageId.set('assistant-current', 450)
    const prependedMessages = [
      message('user-older'),
      message('assistant-older'),
      ...currentMessages,
    ]

    rerender(
      <ScrollContainer>
        <VirtualizedMessageList
          {...baseProps}
          messages={prependedMessages}
          scrollContainerRef={scrollContainerRef}
          totalMessages={prependedMessages.length}
          hasOlderOnDisk={false}
          onLoadOlderRuns={onLoadOlderRuns}
          loadedRunStartIndex={0}
        />
      </ScrollContainer>
    )

    expect(container.scrollTop).toBe(470)
  })

  it('keeps the same compact-list message at the same viewport offset after loading older runs', () => {
    const scrollContainerRef = { current: null as HTMLDivElement | null }
    const onLoadOlderRuns = vi.fn()
    const currentMessages = [
      message('user-current'),
      message('assistant-current'),
    ]

    const { rerender } = render(
      <ScrollContainer>
        <CompactMessageList
          {...baseProps}
          messages={currentMessages}
          scrollContainerRef={scrollContainerRef}
          totalMessages={currentMessages.length}
          hasOlderOnDisk
          onLoadOlderRuns={onLoadOlderRuns}
          loadedRunStartIndex={1}
        />
      </ScrollContainer>
    )
    const container = screen.getByTestId('scroll-container') as HTMLDivElement
    scrollContainerRef.current = container
    container.scrollTop = 250
    rectTopByMessageId.set('user-current', 140)
    rectTopByMessageId.set('assistant-current', 230)

    fireEvent.click(screen.getByRole('button', { name: /load old prompts/i }))

    expect(onLoadOlderRuns).toHaveBeenCalledTimes(1)

    rectTopByMessageId.set('user-current', 360)
    rectTopByMessageId.set('assistant-current', 450)
    const prependedMessages = [
      message('user-older'),
      message('assistant-older'),
      ...currentMessages,
    ]

    rerender(
      <ScrollContainer>
        <CompactMessageList
          {...baseProps}
          messages={prependedMessages}
          scrollContainerRef={scrollContainerRef}
          totalMessages={prependedMessages.length}
          hasOlderOnDisk={false}
          onLoadOlderRuns={onLoadOlderRuns}
          loadedRunStartIndex={0}
        />
      </ScrollContainer>
    )

    expect(container.scrollTop).toBe(470)
  })
})

describe('compact list scroll-driven reveal of hidden prompts', () => {
  it('reveals older in-memory prompts on scroll-up without a click, and anchors the viewport', () => {
    const scrollContainerRef = { current: null as HTMLDivElement | null }
    const onRevealOlderPrompts = vi.fn()
    const onLoadOlderRuns = vi.fn()
    const currentMessages = [
      message('user-current'),
      message('assistant-current'),
    ]

    // First render with nothing loadable so the scroll effect stays unbound
    // while scrollContainerRef is still null.
    const { rerender } = render(
      <ScrollContainer>
        <CompactMessageList
          {...baseProps}
          messages={currentMessages}
          scrollContainerRef={scrollContainerRef}
          totalMessages={currentMessages.length}
          hiddenPromptCount={0}
          onRevealOlderPrompts={onRevealOlderPrompts}
          hasOlderOnDisk={false}
          onLoadOlderRuns={onLoadOlderRuns}
        />
      </ScrollContainer>
    )
    const container = screen.getByTestId('scroll-container') as HTMLDivElement
    scrollContainerRef.current = container

    // Now hidden prompts appear: the effect re-runs and binds the listener.
    rerender(
      <ScrollContainer>
        <CompactMessageList
          {...baseProps}
          messages={currentMessages}
          scrollContainerRef={scrollContainerRef}
          totalMessages={currentMessages.length}
          hiddenPromptCount={7}
          onRevealOlderPrompts={onRevealOlderPrompts}
          hasOlderOnDisk={false}
          onLoadOlderRuns={onLoadOlderRuns}
        />
      </ScrollContainer>
    )

    container.scrollTop = 250
    rectTopByMessageId.set('user-current', 140)
    rectTopByMessageId.set('assistant-current', 230)

    fireEvent.scroll(container)

    // Stage 1 reveals in-memory prompts; the disk fetch stays untouched.
    expect(onRevealOlderPrompts).toHaveBeenCalledTimes(1)
    expect(onLoadOlderRuns).not.toHaveBeenCalled()

    rectTopByMessageId.set('user-current', 360)
    rectTopByMessageId.set('assistant-current', 450)
    const revealedMessages = [
      message('user-older'),
      message('assistant-older'),
      ...currentMessages,
    ]

    rerender(
      <ScrollContainer>
        <CompactMessageList
          {...baseProps}
          messages={revealedMessages}
          scrollContainerRef={scrollContainerRef}
          totalMessages={revealedMessages.length}
          hiddenPromptCount={6}
          onRevealOlderPrompts={onRevealOlderPrompts}
          hasOlderOnDisk={false}
          onLoadOlderRuns={onLoadOlderRuns}
        />
      </ScrollContainer>
    )

    expect(container.scrollTop).toBe(470)
  })

  it('falls through to the disk fetch once no in-memory prompts are hidden', () => {
    const scrollContainerRef = { current: null as HTMLDivElement | null }
    const onRevealOlderPrompts = vi.fn()
    const onLoadOlderRuns = vi.fn()
    const currentMessages = [
      message('user-current'),
      message('assistant-current'),
    ]

    const { rerender } = render(
      <ScrollContainer>
        <CompactMessageList
          {...baseProps}
          messages={currentMessages}
          scrollContainerRef={scrollContainerRef}
          totalMessages={currentMessages.length}
          hiddenPromptCount={0}
          onRevealOlderPrompts={onRevealOlderPrompts}
          hasOlderOnDisk={false}
          onLoadOlderRuns={onLoadOlderRuns}
          loadedRunStartIndex={4}
        />
      </ScrollContainer>
    )
    const container = screen.getByTestId('scroll-container') as HTMLDivElement
    scrollContainerRef.current = container

    rerender(
      <ScrollContainer>
        <CompactMessageList
          {...baseProps}
          messages={currentMessages}
          scrollContainerRef={scrollContainerRef}
          totalMessages={currentMessages.length}
          hiddenPromptCount={0}
          onRevealOlderPrompts={onRevealOlderPrompts}
          hasOlderOnDisk
          onLoadOlderRuns={onLoadOlderRuns}
          loadedRunStartIndex={4}
        />
      </ScrollContainer>
    )

    container.scrollTop = 250
    fireEvent.scroll(container)

    expect(onLoadOlderRuns).toHaveBeenCalledTimes(1)
    expect(onRevealOlderPrompts).not.toHaveBeenCalled()
  })
})
