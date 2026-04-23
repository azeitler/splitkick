import { createRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { ChatInput } from './ChatInput'

const processAttachmentFile = vi.fn()

const storeState = {
  inputDrafts: {} as Record<string, string>,
  setInputDraft: vi.fn(),
  getPendingFiles: vi.fn(() => []),
  removePendingFile: vi.fn(),
  addPendingFile: vi.fn(),
  addPendingSkill: vi.fn(),
  addPendingImage: vi.fn(),
  addPendingTextFile: vi.fn(),
}

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => false,
}))

vi.mock('./attachment-processing', () => ({
  processAttachmentFile: (...args: unknown[]) => processAttachmentFile(...args),
}))

vi.mock('./FileMentionPopover', () => ({
  FileMentionPopover: () => null,
}))

vi.mock('./SlashPopover', () => ({
  SlashPopover: () => null,
}))

vi.mock('@/store/chat-store', () => ({
  useChatStore: {
    getState: () => storeState,
    subscribe: vi.fn(() => vi.fn()),
  },
}))

describe('ChatInput attachments', () => {
  beforeEach(() => {
    processAttachmentFile.mockReset()
    storeState.setInputDraft.mockReset()
    storeState.getPendingFiles.mockReset()
    storeState.getPendingFiles.mockReturnValue([])
    storeState.removePendingFile.mockReset()
    storeState.addPendingFile.mockReset()
    storeState.addPendingSkill.mockReset()
    storeState.addPendingImage.mockReset()
    storeState.addPendingTextFile.mockReset()
    storeState.inputDrafts = {}
  })

  it('registers attach handler and forwards selected files to the processor', async () => {
    const formRef = createRef<HTMLFormElement>()
    const inputRef = createRef<HTMLTextAreaElement>()
    const attachHandlerRef: { current: (() => void) | null } = {
      current: null,
    }

    const { container } = render(
      <ChatInput
        activeSessionId="session-1"
        activeWorktreePath="/tmp/worktree"
        isSending={false}
        executionMode="build"
        focusChatShortcut="⌘K"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        onRegisterAttachHandler={handler => {
          attachHandlerRef.current = handler
        }}
        formRef={formRef}
        inputRef={inputRef}
      />
    )

    const fileInput = container.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement
    expect(fileInput).toBeInTheDocument()

    const clickSpy = vi.spyOn(fileInput, 'click')
    expect(attachHandlerRef.current).not.toBeNull()
    if (attachHandlerRef.current) {
      attachHandlerRef.current()
    }
    expect(clickSpy).toHaveBeenCalledTimes(1)

    const file = new File(['abc'], 'upload.png', { type: 'image/png' })
    processAttachmentFile.mockResolvedValue(undefined)

    fireEvent.change(fileInput, {
      target: { files: [file] },
    })

    await waitFor(() => {
      expect(processAttachmentFile).toHaveBeenCalledWith(file, 'session-1')
    })
  })

  it('renders a shrinkable textarea that wraps long unbroken text', () => {
    const formRef = createRef<HTMLFormElement>()
    const inputRef = createRef<HTMLTextAreaElement>()

    render(
      <ChatInput
        activeSessionId="session-1"
        activeWorktreePath="/tmp/worktree"
        isSending={false}
        executionMode="yolo"
        focusChatShortcut="⌘K"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        formRef={formRef}
        inputRef={inputRef}
      />
    )

    const textarea = screen.getByRole('textbox')

    expect(textarea).toHaveAttribute('wrap', 'soft')
    expect(textarea).toHaveClass(
      'min-w-0',
      'overflow-x-hidden',
      'whitespace-pre-wrap',
      'break-words'
    )
    expect(textarea.className).toContain('[overflow-wrap:anywhere]')
    expect(textarea.parentElement).toHaveClass('min-w-0')
  })
})
