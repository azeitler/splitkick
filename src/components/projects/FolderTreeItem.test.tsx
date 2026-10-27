import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@/test/test-utils'
import { useProjectsStore } from '@/store/projects-store'
import type { Project } from '@/types/projects'
import { FolderTreeItem } from './FolderTreeItem'

vi.mock('@/services/projects', () => ({
  useRenameFolder: () => ({ mutate: vi.fn() }),
}))

vi.mock('./FolderContextMenu', () => ({
  FolderContextMenu: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}))

const folder: Project = {
  id: 'folder-1',
  name: 'Clients',
  path: '',
  default_branch: '',
  added_at: 0,
  order: 0,
  is_folder: true,
}

function renderRow({
  nested = false,
  childCount = 2,
}: { nested?: boolean; childCount?: number } = {}) {
  render(
    <FolderTreeItem folder={folder} childCount={childCount} nested={nested}>
      <div data-testid="folder-child" />
    </FolderTreeItem>
  )
  return screen.getByTestId('folder-row-folder-1')
}

describe('FolderTreeItem row style', () => {
  beforeEach(() => {
    useProjectsStore.setState({
      expandedFolderIds: new Set(),
      editingFolderId: null,
    })
  })

  it('uses the project row shape, padding, gap and colors', () => {
    const row = renderRow()

    // Same classes as a project row (ProjectTreeItem): pill inset, glyph at
    // 16, 6px gap, muted text that turns to foreground on hover.
    for (const cls of [
      'mx-2',
      'rounded-md',
      'pl-2',
      'pr-1',
      'py-1.5',
      'gap-1.5',
      'text-muted-foreground',
      'hover:text-foreground',
    ]) {
      expect(row).toHaveClass(cls)
    }
    // The tree wrapper indents nested rows; the row adds nothing of its own.
    expect(row.style.paddingLeft).toBe('')
  })

  it('uses the project name font, not a bolder, smaller one', () => {
    const row = renderRow()

    expect(row).not.toHaveClass('font-medium')
    expect(row).not.toHaveClass('text-[13px]')
    expect(screen.getByText('Clients').parentElement).toHaveClass('text-sm')
  })

  it('draws the folder glyph at the project avatar size', () => {
    renderRow()

    const icon = screen
      .getByRole('button', { name: 'Expand folder' })
      .querySelector('svg')
    expect(icon).toHaveClass('size-4')
  })
})

describe('FolderTreeItem children', () => {
  beforeEach(() => {
    useProjectsStore.setState({
      expandedFolderIds: new Set(['folder-1']),
      editingFolderId: null,
    })
  })

  it('draws the same hairline under its glyph as a project does', () => {
    renderRow()

    const list = screen.getByTestId('folder-child').parentElement
    // SIDEBAR_WORKTREE_LIST, the list under a top-level project avatar.
    expect(list).toHaveClass('ml-[22px]', 'border-l', 'border-border/40')
  })

  it('moves the hairline with the glyph when the folder is nested', () => {
    const row = renderRow({ nested: true })

    expect(row).toHaveClass('ml-1', 'pl-[5px]')
    expect(row).not.toHaveClass('mx-2')
    const list = screen.getByTestId('folder-child').parentElement
    expect(list).toHaveClass('ml-[15px]', 'border-l')
  })

  it('draws no hairline for an empty folder', () => {
    renderRow({ childCount: 0 })

    expect(screen.getByTestId('folder-child').parentElement).not.toHaveClass(
      'border-l'
    )
  })
})

describe('FolderTreeItem sticky block (#59)', () => {
  it('owns the gap above its children, so a stuck folder keeps it', () => {
    useProjectsStore.setState({
      expandedFolderIds: new Set(['folder-1']),
      editingFolderId: null,
    })
    const row = renderRow()

    // The sticky block carries the 2 px; the list no longer starts with it.
    expect(row.parentElement).toHaveClass('pb-0.5')
    const list = screen.getByTestId('folder-child').parentElement
    expect(list).toHaveClass('pb-0.5')
    expect(list).not.toHaveClass('py-0.5')
  })

  it('adds no gap while the folder is collapsed', () => {
    useProjectsStore.setState({
      expandedFolderIds: new Set(),
      editingFolderId: null,
    })
    const row = renderRow()

    expect(row.parentElement).not.toHaveClass('pb-0.5')
  })
})
