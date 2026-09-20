import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@/test/test-utils'
import { BrowserTextContent } from './BrowserTextContent'
import { useBrowserStore } from '@/store/browser-store'
import type * as Transport from '@/lib/transport'

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/transport', async importOriginal => ({
  ...(await importOriginal<typeof Transport>()),
  invoke: invokeMock,
}))

const addTab = (url: string): string => {
  useBrowserStore.setState({ tabs: {}, activeTabIds: {} })
  return useBrowserStore.getState().addTab('wt-1', url)
}

const tab = (tabId: string) =>
  (useBrowserStore.getState().tabs['wt-1'] ?? []).find(t => t.id === tabId)

describe('BrowserTextContent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders markdown as a document, not as its source', async () => {
    invokeMock.mockResolvedValue('# Release notes\n\n- one\n- two\n')
    const tabId = addTab('file:///repo/NOTES.md')

    const { container } = render(
      <BrowserTextContent tabId={tabId} url="file:///repo/NOTES.md" />
    )

    // The Markdown component styles a heading as a div, so match on the text.
    await screen.findByText('Release notes')
    expect(container.textContent).not.toContain('# Release notes')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(container.querySelector('pre')).toBeNull()
    expect(invokeMock).toHaveBeenCalledWith('read_file_content', {
      path: '/repo/NOTES.md',
    })
  })

  it('keeps non-ASCII characters intact', async () => {
    invokeMock.mockResolvedValue('Ein Bindestrich — und ein Umlaut: Grün.')
    const tabId = addTab('file:///repo/NOTES.md')

    render(<BrowserTextContent tabId={tabId} url="file:///repo/NOTES.md" />)

    await screen.findByText(/Ein Bindestrich — und ein Umlaut: Grün\./)
  })

  it('renders plain text as preformatted text', async () => {
    invokeMock.mockResolvedValue('# not a heading\n  indented')
    const tabId = addTab('file:///repo/build.log')

    const { container } = render(
      <BrowserTextContent tabId={tabId} url="file:///repo/build.log" />
    )

    await waitFor(() => {
      expect(container.querySelector('pre')?.textContent).toBe(
        '# not a heading\n  indented'
      )
    })
    expect(container.querySelector('ul')).toBeNull()
  })

  it('ends the tab load and records the URL when the file is read', async () => {
    invokeMock.mockResolvedValue('hello')
    const tabId = addTab('file:///repo/NOTES.md')
    expect(tab(tabId)?.isLoading).toBe(true)

    render(<BrowserTextContent tabId={tabId} url="file:///repo/NOTES.md" />)

    await waitFor(() => expect(tab(tabId)?.isLoading).toBe(false))
    expect(tab(tabId)?.error).toBeNull()
    expect(tab(tabId)?.lastLoadedUrl).toBe('file:///repo/NOTES.md')
  })

  it('puts a failed read into the tab error, so the pane overlay shows it', async () => {
    invokeMock.mockRejectedValue('File not found: /repo/gone.md')
    const tabId = addTab('file:///repo/gone.md')

    render(<BrowserTextContent tabId={tabId} url="file:///repo/gone.md" />)

    await waitFor(() =>
      expect(tab(tabId)?.error).toBe('File not found: /repo/gone.md')
    )
    expect(tab(tabId)?.isLoading).toBe(false)
  })

  it('reads the file again when the tab asks for a reload', async () => {
    invokeMock.mockResolvedValue('first')
    const tabId = addTab('file:///repo/NOTES.md')

    render(<BrowserTextContent tabId={tabId} url="file:///repo/NOTES.md" />)
    await screen.findByText('first')

    invokeMock.mockResolvedValue('second')
    act(() => useBrowserStore.getState().reloadTab(tabId))

    await screen.findByText('second')
    expect(invokeMock).toHaveBeenCalledTimes(2)
  })
})
