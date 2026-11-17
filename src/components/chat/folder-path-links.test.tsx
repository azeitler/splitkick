import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { Markdown } from '@/components/ui/markdown'
import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'
import type * as Environment from '@/lib/environment'
import type * as Transport from '@/lib/transport'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  canOpenNativeApps: vi.fn(() => true),
  copyToClipboard: vi.fn(async () => undefined),
}))

vi.mock('@/lib/transport', async importOriginal => ({
  ...(await importOriginal<typeof Transport>()),
  invoke: mocks.invoke,
}))

vi.mock('@/lib/environment', async importOriginal => ({
  ...(await importOriginal<typeof Environment>()),
  canOpenNativeApps: () => mocks.canOpenNativeApps(),
}))

vi.mock('@/lib/clipboard', () => ({
  copyToClipboard: mocks.copyToClipboard,
  copyImageToClipboard: vi.fn(),
}))

const WORKTREE = '/repo/wt'

/** The backend: these paths exist, the folders among them are folders. */
const disk = (files: string[], folders: string[] = []) => {
  mocks.invoke.mockImplementation(
    async (command: string, args: { candidates: string[] }) => {
      if (command !== 'resolve_file_reference') return undefined
      const found = args.candidates
        .map(c => c.replace(/^~/, '/Users/me').replace(/\/$/, ''))
        .filter(c => files.includes(c) || folders.includes(c))
      return {
        path: found[0] ?? null,
        candidates: found,
        searched: false,
        isDir: folders.includes(found[0] ?? ''),
      }
    }
  )
}

const resolveCalls = () =>
  mocks.invoke.mock.calls.filter(
    ([command]) => command === 'resolve_file_reference'
  )

describe('paths in inline code', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.canOpenNativeApps.mockReturnValue(true)
    useChatStore.setState({ activeWorktreePath: WORKTREE })
    useUIStore.getState().setViewingFilePath(null)
  })

  it('links a folder that exists, with a folder marker, and opens it in the file manager', async () => {
    disk([], ['/Users/me/Projects/jean/docs'])
    render(<Markdown>{'Docs are in `~/Projects/jean/docs`.'}</Markdown>)

    const link = await screen.findByRole('link', {
      name: '~/Projects/jean/docs',
    })
    expect(link).toHaveAttribute('data-folder')
    expect(link.querySelector('code')).not.toBeNull()
    expect(link.querySelector('svg')).not.toBeNull()

    fireEvent.click(link)
    expect(mocks.invoke).toHaveBeenCalledWith('open_path_in_default_app', {
      path: '/Users/me/Projects/jean/docs',
    })
    expect(useUIStore.getState().viewingFilePath).toBeNull()
  })

  it('links a relative folder with a trailing slash', async () => {
    disk([], [`${WORKTREE}/src/lib`])
    render(<Markdown>{'See `src/lib/`.'}</Markdown>)

    const link = await screen.findByRole('link', { name: 'src/lib/' })
    fireEvent.click(link)
    expect(mocks.invoke).toHaveBeenCalledWith('open_path_in_default_app', {
      path: `${WORKTREE}/src/lib`,
    })
  })

  it('opens a file in inline code in the file viewer', async () => {
    disk([`${WORKTREE}/src/lib/chat-links.ts`])
    render(<Markdown>{'Edit `src/lib/chat-links.ts`.'}</Markdown>)

    const link = await screen.findByRole('link', {
      name: 'src/lib/chat-links.ts',
    })
    expect(link).not.toHaveAttribute('data-folder')
    fireEvent.click(link)
    expect(useUIStore.getState().viewingFilePath).toBe(
      `${WORKTREE}/src/lib/chat-links.ts`
    )
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      'open_path_in_default_app',
      expect.anything()
    )
  })

  it('keeps a path-like token that does not exist as plain code', async () => {
    disk([])
    render(<Markdown>{'Use `a/b` here.'}</Markdown>)

    await waitFor(() => expect(resolveCalls()).toHaveLength(1))
    // Let the answer land, then check there is still no link.
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('a/b').tagName).toBe('CODE')
  })

  it('does not ask the backend about code that is not a path', async () => {
    disk([], [`${WORKTREE}/1`])
    render(
      <Markdown>
        {'Ratio `1/2`, run `npm run dev`, glob `src/**/*.ts`, `ssh://h/x`.'}
      </Markdown>
    )

    await new Promise(resolve => setTimeout(resolve, 0))
    expect(resolveCalls()).toHaveLength(0)
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('never links a path inside a fenced code block', async () => {
    disk([], [`${WORKTREE}/src/lib`])
    render(<Markdown>{'```\nsrc/lib/\n```'}</Markdown>)

    await new Promise(resolve => setTimeout(resolve, 0))
    expect(resolveCalls()).toHaveLength(0)
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('opens a folder from a markdown link in the file manager', async () => {
    disk([], [`${WORKTREE}/docs`])
    render(<Markdown>{'See [the docs](docs/).'}</Markdown>)

    // The link is redrawn as a folder link once the path resolves.
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'the docs' })).toHaveAttribute(
        'data-folder'
      )
    )
    fireEvent.click(screen.getByRole('link', { name: 'the docs' }))
    expect(mocks.invoke).toHaveBeenCalledWith('open_path_in_default_app', {
      path: `${WORKTREE}/docs`,
    })
  })

  it('copies the folder path where the file manager is on another machine', async () => {
    mocks.canOpenNativeApps.mockReturnValue(false)
    disk([], [`${WORKTREE}/docs`])
    render(<Markdown>{'See `docs/`.'}</Markdown>)

    const link = await screen.findByRole('link', { name: 'docs/' })
    fireEvent.click(link)
    await waitFor(() =>
      expect(mocks.copyToClipboard).toHaveBeenCalledWith(`${WORKTREE}/docs`)
    )
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      'open_path_in_default_app',
      expect.anything()
    )
  })
})
