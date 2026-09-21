import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { FileMentionBadge } from './FileMentionBadge'
import type * as Transport from '@/lib/transport'

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/transport', async importOriginal => ({
  ...(await importOriginal<typeof Transport>()),
  invoke: invokeMock,
}))

const WORKTREE = '/repo/worktree'
const REAL = '/repo/worktree/packages/web/src/app.tsx'

const resolveWith = (found: string[], content = 'export default 1\n') => {
  invokeMock.mockImplementation(async (command: string) => {
    if (command === 'resolve_file_reference') {
      return { path: found[0] ?? null, candidates: found, searched: false }
    }
    if (command === 'read_file_content') return content
    return undefined
  })
}

describe('FileMentionBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('previews the file the mention really names, not the root join', async () => {
    resolveWith([REAL])

    render(<FileMentionBadge path="src/app.tsx" worktreePath={WORKTREE} />)

    const badge = screen.getByRole('button')
    await waitFor(() =>
      expect(badge).toHaveAttribute('data-file-reference', 'found')
    )
    fireEvent.click(badge)

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('read_file_content', {
        path: REAL,
      })
    )
  })

  it('offers the worktree join as a candidate for a plain mention', async () => {
    resolveWith([`${WORKTREE}/src/app.tsx`])

    render(<FileMentionBadge path="src/app.tsx" worktreePath={WORKTREE} />)

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('resolve_file_reference', {
        reference: 'src/app.tsx',
        candidates: [`${WORKTREE}/src/app.tsx`],
        searchRoot: WORKTREE,
      })
    )
  })

  it('tries the linked project root before the worktree', async () => {
    resolveWith(['/repo/linked/src/app.tsx'])

    render(
      <FileMentionBadge
        path="src/app.tsx"
        worktreePath={WORKTREE}
        sourceRootPath="/repo/linked"
        sourceProjectName="linked"
      />
    )

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('resolve_file_reference', {
        reference: 'src/app.tsx',
        candidates: ['/repo/linked/src/app.tsx', `${WORKTREE}/src/app.tsx`],
        searchRoot: '/repo/linked',
      })
    )
  })

  it('does not open a preview for a file that is not there', async () => {
    resolveWith([])

    render(<FileMentionBadge path="src/gone.tsx" worktreePath={WORKTREE} />)

    const badge = screen.getByRole('button')
    await waitFor(() =>
      expect(badge).toHaveAttribute('data-file-reference', 'missing')
    )
    fireEvent.click(badge)

    expect(invokeMock).not.toHaveBeenCalledWith(
      'read_file_content',
      expect.anything()
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    // The file icon becomes a question mark, so the badge says why.
    expect(screen.getByLabelText('File not found')).toBeInTheDocument()
  })

  it('asks which file was meant when several match', async () => {
    const other = `${WORKTREE}/src/app.tsx`
    resolveWith([REAL, other])

    render(<FileMentionBadge path="src/app.tsx" worktreePath={WORKTREE} />)

    const badge = () => screen.getByRole('button', { name: /app\.tsx/ })
    await waitFor(() =>
      expect(badge()).toHaveAttribute('data-file-reference', 'ambiguous')
    )
    fireEvent.click(badge())

    await screen.findByText('2 files match — which one?')
    fireEvent.click(screen.getByText('packages/web/src/app.tsx'))

    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith('read_file_content', {
        path: REAL,
      })
    )
  })

  it('never previews a directory mention', async () => {
    resolveWith([`${WORKTREE}/src`])

    render(<FileMentionBadge path="src" worktreePath={WORKTREE} isDirectory />)

    fireEvent.click(screen.getByRole('button'))

    expect(invokeMock).not.toHaveBeenCalledWith(
      'read_file_content',
      expect.anything()
    )
  })
})
