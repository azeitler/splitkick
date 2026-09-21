import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render as renderRaw } from '@testing-library/react'
import { fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { Markdown } from '@/components/ui/markdown'
import { useFileReferenceEvidence } from '@/lib/file-reference'
import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'
import type { ChatMessage } from '@/types/chat'
import type * as Transport from '@/lib/transport'

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/transport', async importOriginal => ({
  ...(await importOriginal<typeof Transport>()),
  invoke: invokeMock,
}))

const WORKTREE = '/repo/worktree'
const TOUCHED = '/repo/worktree/packages/web/docs/api.md'

/** A thread in which the agent read one file, deep inside a package. */
const messages: ChatMessage[] = [
  {
    id: 'm1',
    session_id: 's1',
    role: 'assistant',
    content: '',
    timestamp: 0,
    tool_calls: [{ id: 't1', name: 'Read', input: { file_path: TOUCHED } }],
  },
]

/** Reply with `found` for the paths given, in that order. */
const resolveWith = (...found: string[]) => {
  invokeMock.mockImplementation(async (command: string) =>
    command === 'resolve_file_reference'
      ? { path: found[0] ?? null, candidates: found, searched: false }
      : undefined
  )
}

/** A thread that publishes its evidence, the way ChatWindow does. */
function Thread({
  markdown,
  isSending = false,
}: {
  markdown: string
  isSending?: boolean
}) {
  useFileReferenceEvidence({ worktreePath: WORKTREE, messages, isSending })
  return <Markdown>{markdown}</Markdown>
}

const renderThread = (markdown: string) =>
  render(<Thread markdown={markdown} />)

describe('file references in a chat answer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useChatStore.setState({ activeWorktreePath: WORKTREE })
    useUIStore.getState().setViewingFilePath(null)
  })

  it('opens the file the session actually touched, not the root join', async () => {
    resolveWith(TOUCHED)

    renderThread('See [the API](docs/api.md).')

    const link = await screen.findByRole('link', { name: 'the API' })
    await waitFor(() =>
      expect(link).toHaveAttribute('data-file-reference', 'found')
    )
    fireEvent.click(link)

    expect(useUIStore.getState().viewingFilePath).toBe(TOUCHED)
  })

  it('offers the touched path to the backend before the root join', async () => {
    resolveWith(TOUCHED)

    renderThread('See [the API](docs/api.md).')

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('resolve_file_reference', {
        reference: 'docs/api.md',
        candidates: [TOUCHED, `${WORKTREE}/docs/api.md`],
        searchRoot: WORKTREE,
      })
    )
  })

  it('marks a missing file with a question mark instead of a link', async () => {
    resolveWith()

    renderThread('See [the API](docs/gone.md).')

    // Re-query each time: the link is replaced once the resolution lands.
    const marker = () =>
      screen.getByText('the API').closest('[data-file-reference]')
    await waitFor(() =>
      expect(marker()).toHaveAttribute('data-file-reference', 'missing')
    )
    // Still marked as a file, but nothing to click.
    expect(screen.queryByRole('link', { name: 'the API' })).toBeNull()
    expect(screen.getByLabelText('File not found')).toBeInTheDocument()

    fireEvent.click(screen.getByText('the API'))
    expect(useUIStore.getState().viewingFilePath).toBeNull()
  })

  it('explains the missing link in a tooltip', async () => {
    resolveWith()

    renderThread('See [the API](docs/gone.md).')

    const marker = () =>
      screen
        .getByText('the API')
        .closest('[data-file-reference]') as HTMLElement
    await waitFor(() =>
      expect(marker()).toHaveAttribute('data-file-reference', 'missing')
    )
    // Keyboard users reach it too: the marker takes the link's tab stop.
    expect(marker()).toHaveAttribute('tabindex', '0')
    fireEvent.focus(marker())

    expect(
      (await screen.findAllByText('No file at docs/gone.md')).length
    ).toBeGreaterThan(0)
  })

  it('asks which file was meant when several match', async () => {
    const other = '/repo/worktree/docs/api.md'
    resolveWith(TOUCHED, other)

    renderThread('See [the API](docs/api.md).')

    // The anchor is re-created under the picker's anchor, so re-query it.
    const link = () => screen.getByRole('link', { name: 'the API' })
    await waitFor(() =>
      expect(link()).toHaveAttribute('data-file-reference', 'ambiguous')
    )
    fireEvent.click(link())

    await screen.findByText('2 files match — which one?')
    // Paths are shown relative to the worktree, so the difference is legible.
    fireEvent.click(screen.getByText('docs/api.md'))

    expect(useUIStore.getState().viewingFilePath).toBe(other)
    // Nothing was opened before the user chose.
    expect(invokeMock).not.toHaveBeenCalledWith(
      'read_file_content',
      expect.anything()
    )
  })

  it('keeps the old behaviour while the resolution is in flight', async () => {
    let settle: (value: unknown) => void = () => undefined
    invokeMock.mockImplementation(
      async () => new Promise(resolve => (settle = resolve))
    )

    renderThread('See [the API](docs/api.md).')

    const link = await screen.findByRole('link', { name: 'the API' })
    expect(link).toHaveAttribute('data-file-reference', 'resolving')
    fireEvent.click(link)

    expect(useUIStore.getState().viewingFilePath).toBe(
      `${WORKTREE}/docs/api.md`
    )
    settle(null)
  })

  it('finds the file once the turn that writes it ends', async () => {
    // One client across both renders: the point is that the cached "missing"
    // is thrown away, which a fresh client would fake.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const thread = (isSending: boolean) => (
      <QueryClientProvider client={queryClient}>
        <Thread
          markdown={'See [the API](docs/api.md).'}
          isSending={isSending}
        />
      </QueryClientProvider>
    )

    // The answer names the file before the agent has written it.
    resolveWith()
    const { rerender } = renderRaw(thread(true))
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'the API' })).toBeNull()
    )

    resolveWith(`${WORKTREE}/docs/api.md`)
    rerender(thread(false))

    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'the API' })).toHaveAttribute(
        'data-file-reference',
        'found'
      )
    )
  })

  it('opens a home-relative file at the path the backend expanded', async () => {
    const expanded = '/Users/me/Downloads/report.md'
    resolveWith(expanded)

    renderThread('Saved to [the report](~/Downloads/report.md).')

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('resolve_file_reference', {
        reference: '~/Downloads/report.md',
        candidates: ['~/Downloads/report.md'],
        searchRoot: WORKTREE,
      })
    )
    const link = () => screen.getByRole('link', { name: 'the report' })
    await waitFor(() =>
      expect(link()).toHaveAttribute('data-file-reference', 'found')
    )
    fireEvent.click(link())

    expect(useUIStore.getState().viewingFilePath).toBe(expanded)
  })

  it('says it looked in the home folder for a missing ~/ file', async () => {
    resolveWith()

    renderThread('Saved to [the report](~/Downloads/gone.md).')

    const marker = () =>
      screen
        .getByText('the report')
        .closest('[data-file-reference]') as HTMLElement
    await waitFor(() =>
      expect(marker()).toHaveAttribute('data-file-reference', 'missing')
    )
    fireEvent.focus(marker())

    expect(
      (await screen.findAllByText(/looked for it in the home folder/)).length
    ).toBeGreaterThan(0)
  })

  it('leaves a web link alone', async () => {
    resolveWith()

    renderThread('See [the site](https://example.com).')

    const link = await screen.findByRole('link', { name: 'the site' })
    expect(link).not.toHaveAttribute('data-file-reference')
    expect(invokeMock).not.toHaveBeenCalledWith(
      'resolve_file_reference',
      expect.anything()
    )
  })
})
