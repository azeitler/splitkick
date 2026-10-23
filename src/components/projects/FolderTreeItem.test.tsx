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

function renderRow() {
  render(
    <FolderTreeItem folder={folder} childCount={2}>
      <div />
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
