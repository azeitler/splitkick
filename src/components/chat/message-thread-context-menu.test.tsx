import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import type * as ChatLinks from '@/lib/chat-links'
import type * as Environment from '@/lib/environment'
import type * as Transport from '@/lib/transport'
import { useChatStore } from '@/store/chat-store'
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
  invoke: vi.fn(),
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
  // The real one reads the module's own isLocalBackend, which the line above
  // cannot reach.
  canOpenNativeApps: () => mocks.isLocalBackend(),
  // What `isTauri()` in services/projects really is: a backend exists.
  hasBackend: () => true,
}))

vi.mock('@/lib/transport', async importOriginal => ({
  ...(await importOriginal<typeof Transport>()),
  invoke: (...args: unknown[]) => mocks.invoke(...args),
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
    mocks.invoke.mockReset()
    mocks.invoke.mockResolvedValue(undefined)
    useChatStore.setState({ activeWorktreePath: '/repo/wt' })
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

describe('MessageThreadContextMenu — Reveal in the file manager', () => {
  const REVEALED = '/repo/wt/docs/notes.md'

  beforeEach(() => {
    mocks.isLocalBackend.mockReturnValue(true)
    mocks.invoke.mockReset()
    mocks.invoke.mockImplementation(async (command: string) =>
      command === 'resolve_file_reference'
        ? { path: REVEALED, candidates: [REVEALED], searched: false }
        : undefined
    )
    useChatStore.setState({ activeWorktreePath: '/repo/wt' })
  })

  const openMenuOn = (label: string, href: string) => {
    render(
      <MessageThreadContextMenu messageText="Full message body">
        <a href={href}>{label}</a>
      </MessageThreadContextMenu>
    )
    fireEvent.contextMenu(screen.getByText(label))
  }

  it('reveals the path the reference resolved to', async () => {
    const user = userEvent.setup()
    openMenuOn('notes', 'docs/notes.md')

    await user.click(
      await screen.findByRole('menuitem', { name: /reveal in/i })
    )

    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith('reveal_path_in_file_manager', {
        path: REVEALED,
      })
    )
  })

  it('reveals a home-relative reference where the backend expanded it', async () => {
    const expanded = '/Users/me/Downloads/report.png'
    mocks.invoke.mockImplementation(async (command: string) =>
      command === 'resolve_file_reference'
        ? { path: expanded, candidates: [expanded], searched: false }
        : undefined
    )
    const user = userEvent.setup()
    openMenuOn('report', '~/Downloads/report.png')

    await user.click(
      await screen.findByRole('menuitem', { name: /reveal in/i })
    )

    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith('reveal_path_in_file_manager', {
        path: expanded,
      })
    )
  })

  // The backend looked and found nothing, so Reveal could only raise an error
  // toast. The fallback join covers the resolving state, not this verdict.
  it('offers no reveal for a file the backend reports as missing', async () => {
    mocks.invoke.mockImplementation(async (command: string) =>
      command === 'resolve_file_reference'
        ? { path: null, candidates: [], searched: true }
        : undefined
    )
    openMenuOn('gone', 'docs/gone.md')

    expect(
      await screen.findByRole('menuitem', { name: /copy url/i })
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith(
        'resolve_file_reference',
        expect.anything()
      )
    )
    expect(screen.queryByRole('menuitem', { name: /reveal in/i })).toBeNull()
  })

  it('offers no reveal for a web link', async () => {
    openMenuOn('the docs', 'https://example.com/docs')

    await screen.findByRole('menuitem', { name: /open in default browser/i })
    expect(screen.queryByRole('menuitem', { name: /reveal in/i })).toBeNull()
  })

  it('offers no reveal when the file is on another machine', async () => {
    mocks.isLocalBackend.mockReturnValue(false)
    openMenuOn('notes', 'docs/notes.md')

    await screen.findByRole('menuitem', { name: /copy message/i })
    expect(screen.queryByRole('menuitem', { name: /reveal in/i })).toBeNull()
  })

  it('reveals a chat image by its local path', async () => {
    const user = userEvent.setup()
    render(
      <MessageThreadContextMenu messageText="Full message body">
        <p>
          <button type="button" data-local-path="/tmp/shot.png">
            <img alt="shot" src="/api/files/shot.png" />
          </button>
        </p>
      </MessageThreadContextMenu>
    )
    fireEvent.contextMenu(screen.getByAltText('shot'))

    await user.click(
      await screen.findByRole('menuitem', { name: /reveal in/i })
    )

    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith('reveal_path_in_file_manager', {
        path: '/tmp/shot.png',
      })
    )
  })

  it('offers no image reveal when the file is on another machine', async () => {
    mocks.isLocalBackend.mockReturnValue(false)
    render(
      <MessageThreadContextMenu messageText="Full message body">
        <p>
          <img alt="shot" data-local-path="/tmp/shot.png" src="/x.png" />
        </p>
      </MessageThreadContextMenu>
    )
    fireEvent.contextMenu(screen.getByAltText('shot'))

    await screen.findByRole('menuitem', { name: /copy message/i })
    expect(screen.queryByRole('menuitem', { name: /reveal in/i })).toBeNull()
  })

  it('falls back to the plain join while the resolution is in flight', async () => {
    mocks.invoke.mockImplementation((command: string) =>
      command === 'resolve_file_reference'
        ? new Promise(() => undefined)
        : Promise.resolve(undefined)
    )
    const user = userEvent.setup()
    openMenuOn('notes', 'docs/notes.md')

    await user.click(
      await screen.findByRole('menuitem', { name: /reveal in/i })
    )

    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith('reveal_path_in_file_manager', {
        path: '/repo/wt/docs/notes.md',
      })
    )
  })
})
