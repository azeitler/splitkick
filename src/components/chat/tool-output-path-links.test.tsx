import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { ToolCallInline } from './ToolCallInline'
import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'
import type { ToolCall } from '@/types/chat'
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

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({ data: undefined }),
}))

const WORKTREE = '/repo/wt'

/** The backend: these relative paths exist under the worktree. */
const disk = (files: string[], folders: string[] = []) => {
  mocks.invoke.mockImplementation(
    async (command: string, args: { paths: string[]; root: string }) => {
      if (command !== 'check_paths') return undefined
      return args.paths.map(path => {
        const clean = path.replace(/^\.\//, '').replace(/\/$/, '')
        const exists = files.includes(clean) || folders.includes(clean)
        return {
          path,
          exists,
          isDir: folders.includes(clean),
          resolvedPath: exists ? `${args.root}/${clean}` : null,
        }
      })
    }
  )
}

const checkCalls = () =>
  mocks.invoke.mock.calls.filter(([command]) => command === 'check_paths')

const OUTPUT = [
  'src/lib/a.ts:12:export const a = 1',
  'src/lib/gone.ts:3:nothing here',
  'docs/developer/',
].join('\n')

const bash = (output = OUTPUT): ToolCall => ({
  id: 'bash-1',
  name: 'Bash',
  input: { command: 'grep -n a src && ls -d docs/developer/' },
  output,
})

function expand() {
  const trigger = document.querySelector('[data-slot="collapsible-trigger"]')
  if (!trigger) throw new Error('No collapsible trigger found')
  fireEvent.click(trigger)
}

describe('paths in tool output', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.canOpenNativeApps.mockReturnValue(true)
    useChatStore.setState({ activeWorktreePath: WORKTREE })
    useUIStore.getState().setViewingFilePath(null)
  })

  it('checks nothing while the tool call is collapsed', async () => {
    disk(['src/lib/a.ts'])
    render(<ToolCallInline toolCall={bash()} />)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(checkCalls()).toHaveLength(0)
  })

  it('links only existing paths, with one batch call, and keeps the text', async () => {
    disk(['src/lib/a.ts'], ['docs/developer'])
    render(<ToolCallInline toolCall={bash()} />)
    expand()

    const file = await screen.findByRole('link', { name: 'src/lib/a.ts:12' })
    expect(file).toHaveAttribute('href', `${WORKTREE}/src/lib/a.ts`)
    const folder = screen.getByRole('link', { name: 'docs/developer/' })
    expect(folder).toHaveAttribute('data-folder')
    expect(screen.queryByRole('link', { name: /gone/ })).toBeNull()

    expect(checkCalls()).toEqual([
      [
        'check_paths',
        {
          paths: ['src/lib/a.ts', 'src/lib/gone.ts', 'docs/developer/'],
          root: WORKTREE,
        },
      ],
    ])
    const pre = file.closest('pre')
    expect(pre?.textContent).toBe(OUTPUT)
    expect(pre).toHaveClass('font-mono')
  })

  it('opens a grep hit in the file viewer and a folder in the file manager', async () => {
    disk(['src/lib/a.ts'], ['docs/developer'])
    render(<ToolCallInline toolCall={bash()} />)
    expand()

    fireEvent.click(
      await screen.findByRole('link', { name: 'src/lib/a.ts:12' })
    )
    expect(useUIStore.getState().viewingFilePath).toBe(
      `${WORKTREE}/src/lib/a.ts`
    )

    fireEvent.click(screen.getByRole('link', { name: 'docs/developer/' }))
    expect(mocks.invoke).toHaveBeenCalledWith('open_path_in_default_app', {
      path: `${WORKTREE}/docs/developer`,
    })
  })

  it('copies a folder path where the file manager is not reachable', async () => {
    mocks.canOpenNativeApps.mockReturnValue(false)
    disk([], ['docs/developer'])
    render(<ToolCallInline toolCall={bash()} />)
    expand()

    fireEvent.click(
      await screen.findByRole('link', { name: 'docs/developer/' })
    )
    await waitFor(() =>
      expect(mocks.copyToClipboard).toHaveBeenCalledWith(
        `${WORKTREE}/docs/developer`
      )
    )
    expect(mocks.invoke).not.toHaveBeenCalledWith(
      'open_path_in_default_app',
      expect.anything()
    )
  })

  it('links paths in the raw output of other tools', async () => {
    disk(['src/lib/a.ts'])
    render(
      <ToolCallInline
        toolCall={{
          id: 'grep-1',
          name: 'Grep',
          input: { pattern: 'a' },
          output: 'Found 1 file\nsrc/lib/a.ts',
        }}
      />
    )
    expand()
    expect(
      await screen.findByRole('link', { name: 'src/lib/a.ts' })
    ).toBeInTheDocument()
    expect(checkCalls()).toHaveLength(1)
  })

  it('makes no call when the output holds no path', async () => {
    disk([])
    render(<ToolCallInline toolCall={bash('hello world\n42')} />)
    expand()
    expect(screen.getByText(/hello world/)).toBeInTheDocument()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(checkCalls()).toHaveLength(0)
  })
})
