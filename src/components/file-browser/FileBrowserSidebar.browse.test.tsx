import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { FileBrowserSidebar } from './FileBrowserSidebar'
import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'
import type * as FilesService from '@/services/files'
import type * as ProjectsService from '@/services/projects'
import type { WorktreeFile } from '@/types/chat'

const mocks = vi.hoisted(() => ({
  openUrlInEmbeddedBrowser: vi.fn(),
  isLocalBackend: vi.fn(() => true),
}))

const FILES: WorktreeFile[] = [
  { relative_path: 'index.html', extension: 'html', is_dir: false },
  { relative_path: 'main.rs', extension: 'rs', is_dir: false },
]

vi.mock('@/services/files', async () => {
  const actual = await vi.importActual<typeof FilesService>('@/services/files')
  return {
    ...actual,
    useWorktreeFiles: () => ({
      data: FILES,
      isLoading: false,
      isFetching: false,
      isError: false,
      error: null,
    }),
  }
})

vi.mock('@/services/projects', async () => {
  const actual = await vi.importActual<typeof ProjectsService>(
    '@/services/projects'
  )
  return {
    ...actual,
    useWorktree: () => ({ data: undefined }),
    useProjects: () => ({ data: [] }),
  }
})

vi.mock('@/hooks/useBrowserPane', () => ({
  openUrlInEmbeddedBrowser: mocks.openUrlInEmbeddedBrowser,
}))

vi.mock('@/lib/environment', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isLocalBackend: mocks.isLocalBackend,
}))

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => false,
}))

const ROOT = '/Users/dev/project'
const HTML_URL = 'file:///Users/dev/project/index.html'

describe('FileBrowserSidebar HTML browsing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.openUrlInEmbeddedBrowser.mockResolvedValue(true)
    mocks.isLocalBackend.mockReturnValue(true)
    useChatStore.setState({ activeWorktreePath: ROOT })
    useUIStore.setState({ viewingFilePath: null })
  })

  it('selects an HTML file on single click without opening the viewer', async () => {
    const user = userEvent.setup()
    render(<FileBrowserSidebar />)

    await user.click(screen.getByRole('treeitem', { name: 'index.html' }))

    expect(
      screen
        .getByRole('treeitem', { name: 'index.html' })
        .getAttribute('aria-selected')
    ).toBe('true')
    expect(useUIStore.getState().viewingFilePath).toBeNull()
    expect(mocks.openUrlInEmbeddedBrowser).not.toHaveBeenCalled()
  })

  it('opens an HTML file in the embedded browser on double-click', async () => {
    const user = userEvent.setup()
    render(<FileBrowserSidebar />)

    await user.dblClick(screen.getByRole('treeitem', { name: 'index.html' }))

    await waitFor(() =>
      expect(mocks.openUrlInEmbeddedBrowser).toHaveBeenCalledWith(HTML_URL)
    )
    expect(mocks.openUrlInEmbeddedBrowser).toHaveBeenCalledTimes(1)
    expect(useUIStore.getState().viewingFilePath).toBeNull()
  })

  it('opens an HTML file in the embedded browser on Enter', async () => {
    render(<FileBrowserSidebar />)

    fireEvent.keyDown(screen.getByRole('treeitem', { name: 'index.html' }), {
      key: 'Enter',
    })

    await waitFor(() =>
      expect(mocks.openUrlInEmbeddedBrowser).toHaveBeenCalledWith(HTML_URL)
    )
  })

  it('still opens other files in the viewer on single click', async () => {
    const user = userEvent.setup()
    render(<FileBrowserSidebar />)

    await user.click(screen.getByRole('treeitem', { name: 'main.rs' }))

    expect(useUIStore.getState().viewingFilePath).toBe(`${ROOT}/main.rs`)
    expect(mocks.openUrlInEmbeddedBrowser).not.toHaveBeenCalled()
  })

  it('keeps the viewer on single click when the file cannot be browsed', async () => {
    mocks.isLocalBackend.mockReturnValue(false)
    const user = userEvent.setup()
    render(<FileBrowserSidebar />)

    await user.click(screen.getByRole('treeitem', { name: 'index.html' }))

    expect(useUIStore.getState().viewingFilePath).toBe(`${ROOT}/index.html`)
    expect(mocks.openUrlInEmbeddedBrowser).not.toHaveBeenCalled()
  })
})
