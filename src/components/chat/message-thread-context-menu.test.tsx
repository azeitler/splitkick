import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import type * as ChatLinks from '@/lib/chat-links'
import type * as Environment from '@/lib/environment'
import {
  getTrimmedSelectionText,
  MessageThreadContextMenu,
  suppressDefaultContextMenu,
} from './message-thread-context-menu'

const mocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  openChatLink: vi.fn(),
  isLocalBackend: vi.fn(() => true),
}))

vi.mock('@/lib/clipboard', () => ({
  copyToClipboard: mocks.copyToClipboard,
}))

vi.mock('@/lib/chat-links', async importOriginal => ({
  ...(await importOriginal<typeof ChatLinks>()),
  openChatLink: mocks.openChatLink,
}))

vi.mock('@/lib/environment', async importOriginal => ({
  ...(await importOriginal<typeof Environment>()),
  isNativeApp: () => true,
  isLocalBackend: () => mocks.isLocalBackend(),
}))

vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}))

describe('getTrimmedSelectionText', () => {
  it('returns trimmed window selection text', () => {
    const original = window.getSelection
    window.getSelection = () =>
      ({
        toString: () => '  hello world  ',
      }) as Selection

    expect(getTrimmedSelectionText()).toBe('hello world')

    window.getSelection = original
  })

  it('returns empty string when there is no selection', () => {
    const original = window.getSelection
    window.getSelection = () => null

    expect(getTrimmedSelectionText()).toBe('')

    window.getSelection = original
  })
})

describe('suppressDefaultContextMenu', () => {
  it('prevents the default context menu', () => {
    const event = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
    })
    const preventDefault = vi.spyOn(event, 'preventDefault')
    suppressDefaultContextMenu(event)
    expect(preventDefault).toHaveBeenCalled()
  })
})

describe('MessageThreadContextMenu', () => {
  beforeEach(() => {
    mocks.copyToClipboard.mockReset()
    mocks.toastSuccess.mockReset()
    mocks.toastError.mockReset()
    mocks.copyToClipboard.mockResolvedValue(undefined)
    mocks.openChatLink.mockReset()
    mocks.isLocalBackend.mockReturnValue(true)
  })

  it('opens a web link in the default browser', async () => {
    const user = userEvent.setup()

    render(
      <MessageThreadContextMenu messageText="Full message body">
        <a href="https://example.com/docs">the docs</a>
      </MessageThreadContextMenu>
    )

    fireEvent.contextMenu(screen.getByText('the docs'))
    await user.click(
      await screen.findByRole('menuitem', { name: /open in default browser/i })
    )

    expect(mocks.openChatLink).toHaveBeenCalledWith(
      'https://example.com/docs',
      expect.objectContaining({ system: true })
    )
  })

  it('offers a local HTML page with its raw path, not the resolved href', async () => {
    const user = userEvent.setup()

    render(
      <MessageThreadContextMenu messageText="Full message body">
        <a href="out/report.html">report</a>
      </MessageThreadContextMenu>
    )

    fireEvent.contextMenu(screen.getByText('report'))
    await user.click(
      await screen.findByRole('menuitem', { name: /open in default browser/i })
    )

    expect(mocks.openChatLink).toHaveBeenCalledWith(
      'out/report.html',
      expect.objectContaining({ system: true })
    )
  })

  it('hides the item for a local page the backend does not share', async () => {
    mocks.isLocalBackend.mockReturnValue(false)

    render(
      <MessageThreadContextMenu messageText="Full message body">
        <a href="out/report.html">report</a>
      </MessageThreadContextMenu>
    )

    fireEvent.contextMenu(screen.getByText('report'))

    expect(
      await screen.findByRole('menuitem', { name: /copy url/i })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: /open in default browser/i })
    ).toBeNull()
  })

  it('hides the item for a link to a file a browser cannot show', async () => {
    render(
      <MessageThreadContextMenu messageText="Full message body">
        <a href="src/main.ts">source</a>
      </MessageThreadContextMenu>
    )

    fireEvent.contextMenu(screen.getByText('source'))

    expect(
      await screen.findByRole('menuitem', { name: /copy url/i })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: /open in default browser/i })
    ).toBeNull()
  })

  it('shows Copy message and copies full text when nothing is selected', async () => {
    const user = userEvent.setup()
    const original = window.getSelection
    window.getSelection = () =>
      ({
        toString: () => '',
      }) as Selection

    render(
      <MessageThreadContextMenu messageText="Full message body">
        <div>message body</div>
      </MessageThreadContextMenu>
    )

    fireEvent.contextMenu(screen.getByText('message body'))

    const item = await screen.findByRole('menuitem', { name: /copy message/i })
    await user.click(item)

    await waitFor(() => {
      expect(mocks.copyToClipboard).toHaveBeenCalledWith('Full message body')
      expect(mocks.toastSuccess).toHaveBeenCalledWith('Copied to clipboard')
    })

    window.getSelection = original
  })

  it('hides Fork from here unless a handler is supplied', async () => {
    const original = window.getSelection
    window.getSelection = () => ({ toString: () => '' }) as Selection

    render(
      <MessageThreadContextMenu messageText="Full message body">
        <div>message body</div>
      </MessageThreadContextMenu>
    )

    fireEvent.contextMenu(screen.getByText('message body'))

    await screen.findByRole('menuitem', { name: /copy message/i })
    expect(
      screen.queryByRole('menuitem', { name: /fork from here/i })
    ).toBeNull()

    window.getSelection = original
  })

  it('shows Fork from here and calls the handler', async () => {
    const user = userEvent.setup()
    const onForkFromHere = vi.fn()
    const original = window.getSelection
    window.getSelection = () => ({ toString: () => '' }) as Selection

    render(
      <MessageThreadContextMenu
        messageText="Full message body"
        onForkFromHere={onForkFromHere}
      >
        <div>message body</div>
      </MessageThreadContextMenu>
    )

    fireEvent.contextMenu(screen.getByText('message body'))

    const item = await screen.findByRole('menuitem', {
      name: /fork from here/i,
    })
    await user.click(item)

    await waitFor(() => {
      expect(onForkFromHere).toHaveBeenCalledTimes(1)
    })

    window.getSelection = original
  })

  it('shows Copy for selection and prefers selected text', async () => {
    const user = userEvent.setup()
    const original = window.getSelection
    window.getSelection = () =>
      ({
        toString: () => 'selected bit',
      }) as Selection

    render(
      <MessageThreadContextMenu
        messageText="Full message body"
        copyMessageLabel="Copy response"
      >
        <div>message body</div>
      </MessageThreadContextMenu>
    )

    fireEvent.contextMenu(screen.getByText('message body'))

    expect(
      await screen.findByRole('menuitem', { name: /^copy$/i })
    ).toBeVisible()
    expect(
      screen.getByRole('menuitem', { name: /copy response/i })
    ).toBeVisible()

    await user.click(screen.getByRole('menuitem', { name: /^copy$/i }))

    await waitFor(() => {
      expect(mocks.copyToClipboard).toHaveBeenCalledWith('selected bit')
    })

    window.getSelection = original
  })

  it('copies the URL when right-clicking an element inside a link', async () => {
    const user = userEvent.setup()
    const original = window.getSelection
    window.getSelection = () =>
      ({
        toString: () => '',
      }) as Selection

    render(
      <MessageThreadContextMenu messageText="Full message body">
        <div>
          <a href="/docs">
            <span>documentation</span>
          </a>
        </div>
      </MessageThreadContextMenu>
    )

    fireEvent.contextMenu(screen.getByText('documentation'))
    await user.click(await screen.findByRole('menuitem', { name: /copy url/i }))

    await waitFor(() => {
      expect(mocks.copyToClipboard).toHaveBeenCalledWith(
        'http://localhost:3000/docs'
      )
      expect(mocks.toastSuccess).toHaveBeenCalledWith('Copied to clipboard')
    })

    window.getSelection = original
  })

  it('uses onCopyMessage when provided', async () => {
    const user = userEvent.setup()
    const onCopyMessage = vi.fn().mockResolvedValue(undefined)
    const original = window.getSelection
    window.getSelection = () =>
      ({
        toString: () => '',
      }) as Selection

    render(
      <MessageThreadContextMenu onCopyMessage={onCopyMessage}>
        <div>user prompt</div>
      </MessageThreadContextMenu>
    )

    fireEvent.contextMenu(screen.getByText('user prompt'))
    await user.click(
      await screen.findByRole('menuitem', { name: /copy message/i })
    )

    expect(onCopyMessage).toHaveBeenCalledTimes(1)
    expect(mocks.copyToClipboard).not.toHaveBeenCalled()

    window.getSelection = original
  })

  it('shows a disabled placeholder when there is nothing to copy', async () => {
    const original = window.getSelection
    window.getSelection = () =>
      ({
        toString: () => '',
      }) as Selection

    render(
      <MessageThreadContextMenu messageText="   ">
        <div>empty-ish</div>
      </MessageThreadContextMenu>
    )

    fireEvent.contextMenu(screen.getByText('empty-ish'))

    const item = await screen.findByRole('menuitem', {
      name: /no text to copy/i,
    })
    expect(item).toHaveAttribute('data-disabled')

    window.getSelection = original
  })
})
