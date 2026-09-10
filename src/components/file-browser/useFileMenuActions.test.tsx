import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { useFileMenuActions } from './useFileMenuActions'
import type { FileTreeNode } from './build-file-tree'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  revealMutate: vi.fn(),
  copyToClipboard: vi.fn(),
  addPendingFile: vi.fn(),
  getActiveSession: vi.fn(),
  activeWorktreeId: 'wt-1' as string | null,
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastLoading: vi.fn(() => 'toast-id'),
  openUrlInEmbeddedBrowser: vi.fn(),
  isLocalBackend: vi.fn(() => true),
}))

vi.mock('@/hooks/useBrowserPane', () => ({
  openUrlInEmbeddedBrowser: mocks.openUrlInEmbeddedBrowser,
}))
vi.mock('@/lib/environment', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isLocalBackend: mocks.isLocalBackend,
}))

vi.mock('@/lib/transport', () => ({ invoke: mocks.invoke }))
vi.mock('@/lib/clipboard', () => ({ copyToClipboard: mocks.copyToClipboard }))
vi.mock('@/services/projects', () => ({
  useRevealPathInFileManager: () => ({ mutate: mocks.revealMutate }),
}))
vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({ data: { editor: 'cursor', terminal: 'ghostty' } }),
}))
vi.mock('@/store/chat-store', () => ({
  useChatStore: {
    getState: () => ({
      activeWorktreeId: mocks.activeWorktreeId,
      getActiveSession: mocks.getActiveSession,
      addPendingFile: mocks.addPendingFile,
    }),
  },
}))
vi.mock('sonner', () => ({
  toast: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
    loading: mocks.toastLoading,
  },
}))

const fileNode: FileTreeNode = {
  name: 'main.rs',
  relativePath: 'src/main.rs',
  isDir: false,
  extension: 'rs',
  children: [],
}

const htmlNode: FileTreeNode = {
  name: 'index.html',
  relativePath: 'my site/index.html',
  isDir: false,
  extension: 'html',
  children: [],
}

function BrowseHarness({
  rootPath,
  node,
}: {
  rootPath: string | null
  node: FileTreeNode
}) {
  const actions = useFileMenuActions(rootPath)
  return (
    <div>
      <span data-testid="browsable">{String(actions.isBrowsable(node))}</span>
      <button type="button" onClick={() => void actions.handleBrowse(node)}>
        browse
      </button>
    </div>
  )
}

function Harness({ rootPath }: { rootPath: string | null }) {
  const actions = useFileMenuActions(rootPath)
  return (
    <div>
      <span data-testid="editor-label">{actions.editorLabel}</span>
      <button type="button" onClick={() => actions.handleReveal(fileNode)}>
        reveal
      </button>
      <button
        type="button"
        onClick={() => actions.handleOpenInEditor(fileNode)}
      >
        editor
      </button>
      <button
        type="button"
        onClick={() => actions.handleOpenInDefaultApp(fileNode)}
      >
        default-app
      </button>
      <button type="button" onClick={() => actions.handleCopyPath(fileNode)}>
        copy-path
      </button>
      <button
        type="button"
        onClick={() => actions.handleCopyRelativePath(fileNode)}
      >
        copy-relative
      </button>
      <button type="button" onClick={() => actions.handleAddToChat(fileNode)}>
        add-to-chat
      </button>
    </div>
  )
}

describe('useFileMenuActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.invoke.mockResolvedValue(undefined)
    mocks.copyToClipboard.mockResolvedValue(undefined)
    mocks.getActiveSession.mockReturnValue('session-1')
    mocks.activeWorktreeId = 'wt-1'
    mocks.toastLoading.mockReturnValue('toast-id')
    mocks.openUrlInEmbeddedBrowser.mockResolvedValue(true)
    mocks.isLocalBackend.mockReturnValue(true)
  })

  it('reveals the absolute path built from the root', async () => {
    const user = userEvent.setup()
    render(<Harness rootPath="/Users/dev/project" />)

    await user.click(screen.getByText('reveal'))

    expect(mocks.revealMutate).toHaveBeenCalledWith(
      '/Users/dev/project/src/main.rs'
    )
  })

  it('does nothing while no root path is known', async () => {
    const user = userEvent.setup()
    render(<Harness rootPath={null} />)

    await user.click(screen.getByText('reveal'))
    await user.click(screen.getByText('copy-path'))

    expect(mocks.revealMutate).not.toHaveBeenCalled()
    expect(mocks.copyToClipboard).not.toHaveBeenCalled()
  })

  it('uses the editor command for Open in Editor and the shell-association command for Open in Default App', async () => {
    const user = userEvent.setup()
    render(<Harness rootPath="/Users/dev/project" />)

    await user.click(screen.getByText('editor'))
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith('open_file_in_default_app', {
        path: '/Users/dev/project/src/main.rs',
        editor: 'cursor',
      })
    )

    // `open_file_in_default_app` always launches an editor (Zed when no editor
    // is given), so the default-app item must use the shell-association
    // command instead.
    await user.click(screen.getByText('default-app'))
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenLastCalledWith(
        'open_path_in_default_app',
        { path: '/Users/dev/project/src/main.rs' }
      )
    )
  })

  it('copies the absolute and the relative path', async () => {
    const user = userEvent.setup()
    render(<Harness rootPath="/Users/dev/project" />)

    await user.click(screen.getByText('copy-path'))
    await waitFor(() =>
      expect(mocks.copyToClipboard).toHaveBeenCalledWith(
        '/Users/dev/project/src/main.rs'
      )
    )

    await user.click(screen.getByText('copy-relative'))
    await waitFor(() =>
      expect(mocks.copyToClipboard).toHaveBeenLastCalledWith('src/main.rs')
    )
  })

  it('adds a pending file and appends the mention to the composer', async () => {
    const user = userEvent.setup()
    const appended = vi.fn()
    window.addEventListener('append-chat-input', appended)

    render(<Harness rootPath="/Users/dev/project" />)
    await user.click(screen.getByText('add-to-chat'))

    expect(mocks.addPendingFile).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        relativePath: 'src/main.rs',
        extension: 'rs',
        isDirectory: false,
      })
    )
    expect(appended).toHaveBeenCalled()
    const event = appended.mock.calls[0]?.[0] as CustomEvent<{ text: string }>
    expect(event.detail.text).toBe('@main.rs ')

    window.removeEventListener('append-chat-input', appended)
  })

  it('warns instead of mentioning when no session is active', async () => {
    mocks.getActiveSession.mockReturnValue(undefined)
    const user = userEvent.setup()
    render(<Harness rootPath="/Users/dev/project" />)

    await user.click(screen.getByText('add-to-chat'))

    expect(mocks.addPendingFile).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith(
      'Open a session first to mention a file'
    )
  })

  it('treats an HTML file as browsable on the local desktop backend', () => {
    render(<BrowseHarness rootPath="/Users/dev/project" node={htmlNode} />)
    expect(screen.getByTestId('browsable').textContent).toBe('true')
  })

  it.each([
    ['a non-HTML file', fileNode, true],
    ['a folder named like HTML', { ...htmlNode, isDir: true }, true],
    ['an HTML file on a remote backend', htmlNode, false],
  ])('does not treat %s as browsable', (_label, node, localBackend) => {
    mocks.isLocalBackend.mockReturnValue(localBackend)
    render(<BrowseHarness rootPath="/Users/dev/project" node={node} />)
    expect(screen.getByTestId('browsable').textContent).toBe('false')
  })

  it('opens the file URL of the row in the embedded browser', async () => {
    const user = userEvent.setup()
    render(<BrowseHarness rootPath="/Users/dev/project" node={htmlNode} />)

    await user.click(screen.getByText('browse'))

    expect(mocks.openUrlInEmbeddedBrowser).toHaveBeenCalledWith(
      'file:///Users/dev/project/my%20site/index.html'
    )
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('tells the user when no browser surface can show the file', async () => {
    mocks.openUrlInEmbeddedBrowser.mockResolvedValue(false)
    const user = userEvent.setup()
    render(<BrowseHarness rootPath="/Users/dev/project" node={htmlNode} />)

    await user.click(screen.getByText('browse'))

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        'Open a session first to browse this file'
      )
    )
  })
})
