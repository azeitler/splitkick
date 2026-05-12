import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@/test/test-utils'
import { FileMentionPopover } from './FileMentionPopover'
import type { WorktreeFile } from '@/types/chat'

const filesByRoot: Record<string, WorktreeFile[]> = {
  '/tmp/current-worktree': [
    { relative_path: 'src/App.tsx', extension: 'tsx', is_dir: false },
  ],
  '/tmp/docs': [
    { relative_path: 'docs/intro.md', extension: 'md', is_dir: false },
  ],
}

vi.mock('@/services/files', async () => {
  const actual =
    await vi.importActual<typeof import('@/services/files')>('@/services/files')
  return {
    ...actual,
    useWorktreeFiles: (rootPath: string | null) => ({
      data: rootPath ? (filesByRoot[rootPath] ?? []) : [],
    }),
  }
})

vi.mock('@/services/projects', async () => {
  const actual = await vi.importActual<typeof import('@/services/projects')>(
    '@/services/projects'
  )
  return {
    ...actual,
    useProjects: () => ({
      data: [
        {
          id: 'current',
          name: 'Jean',
          path: '/tmp/jean',
          default_branch: 'main',
          added_at: 0,
          order: 0,
          linked_project_ids: ['docs'],
        },
        {
          id: 'docs',
          name: 'Docs',
          path: '/tmp/docs',
          default_branch: 'main',
          added_at: 0,
          order: 1,
          linked_project_ids: ['current'],
        },
      ],
    }),
  }
})

describe('FileMentionPopover linked project scopes', () => {
  beforeAll(() => {
    class ResizeObserverMock {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('shows linked projects first and only switches file search after a project click', () => {
    const onSelectFile = vi.fn()

    render(
      <FileMentionPopover
        worktreePath="/tmp/current-worktree"
        currentProjectId="current"
        open
        onOpenChange={vi.fn()}
        onSelectFile={onSelectFile}
        searchQuery=""
        anchorPosition={{ top: 0, left: 0 }}
      />
    )

    expect(screen.getByText('Jean (current)')).toBeInTheDocument()
    expect(screen.getByText('Docs')).toBeInTheDocument()
    expect(screen.getByText('src/App.tsx')).toBeInTheDocument()
    expect(screen.queryByText('docs/intro.md')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Docs'))

    expect(screen.queryByText('selected')).not.toBeInTheDocument()
    expect(screen.getByText('Docs').closest('[role="option"]')).toHaveClass(
      '!bg-primary/15'
    )
    expect(screen.getByText('docs/intro.md')).toBeInTheDocument()
    expect(screen.queryByText('src/App.tsx')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('docs/intro.md'))

    expect(onSelectFile).toHaveBeenCalledWith(
      expect.objectContaining({
        relativePath: 'docs/intro.md',
        sourceRootPath: '/tmp/docs',
        sourceProjectId: 'docs',
        sourceProjectName: 'Docs',
      })
    )
  })
})
