import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@/test/test-utils'
import { ProjectTree } from './ProjectTree'
import type { Project } from '@/types/projects'
import { useProjectsStore } from '@/store/projects-store'

// Drag and drop is irrelevant here; every registration returns a no-op cleanup.
const noopCleanup = vi.hoisted(() => () => () => undefined)
const draggable = vi.hoisted(() =>
  vi.fn((_args: { element: Element; dragHandle?: Element }) => () => undefined)
)

const dropTargetForElements = vi.hoisted(() =>
  vi.fn((_args: { element: Element }) => () => undefined)
)

vi.mock('@atlaskit/pragmatic-drag-and-drop/element/adapter', () => ({
  draggable,
  dropTargetForElements,
  monitorForElements: noopCleanup,
}))

vi.mock('@atlaskit/pragmatic-drag-and-drop/combine', () => ({
  combine: noopCleanup,
}))

vi.mock('@atlaskit/pragmatic-drag-and-drop-hitbox/list-item', () => ({
  attachInstruction: (data: unknown) => data,
  extractInstruction: () => null,
}))

vi.mock('@/services/projects', () => ({
  useReorderItems: () => ({ mutate: vi.fn() }),
  useMoveItem: () => ({ mutate: vi.fn() }),
}))

vi.mock('./ProjectTreeItem', () => ({
  ProjectTreeItem: ({
    project,
    dragHandleRef,
    nested,
  }: {
    project: Project
    dragHandleRef?: React.Ref<HTMLDivElement>
    nested?: boolean
  }) => (
    <div>
      <div
        ref={dragHandleRef}
        data-testid={`project-${project.id}`}
        data-nested={String(Boolean(nested))}
      >
        {project.name}
      </div>
      <div data-testid={`project-body-${project.id}`} />
    </div>
  ),
}))

vi.mock('./FolderTreeItem', () => ({
  FolderTreeItem: ({
    folder,
    dragHandleRef,
    children,
    nested,
  }: {
    folder: Project
    dragHandleRef?: React.Ref<HTMLDivElement>
    children?: React.ReactNode
    nested?: boolean
  }) => (
    <div>
      <div
        ref={dragHandleRef}
        data-testid={`folder-${folder.id}`}
        data-nested={String(Boolean(nested))}
      >
        {folder.name}
      </div>
      {children}
    </div>
  ),
}))

const folder: Project = {
  id: 'folder-1',
  name: 'Work',
  path: '',
  default_branch: 'main',
  added_at: 0,
  order: 0,
  is_folder: true,
}

const project: Project = {
  id: 'project-1',
  name: 'jean',
  path: '/tmp/jean',
  default_branch: 'main',
  added_at: 0,
  order: 1,
}

const projects = [folder, project]

describe('ProjectTree drag handle', () => {
  it('starts a drag only from the project and folder rows', () => {
    draggable.mockClear()
    useProjectsStore.setState({
      expandedProjectIds: new Set(['project-1']),
      expandedFolderIds: new Set(),
    })
    render(<ProjectTree projects={projects} />)

    const handles = draggable.mock.calls.map(([args]) => args.dragHandle)
    expect(handles).toContain(screen.getByTestId('project-project-1'))
    expect(handles).toContain(screen.getByTestId('folder-folder-1'))
    expect(handles).not.toContain(undefined)
  })
})

describe('ProjectTree flat root', () => {
  beforeEach(() => {
    useProjectsStore.setState({
      expandedProjectIds: new Set(),
      expandedFolderIds: new Set(),
    })
  })

  it('lists folders and root projects directly, without section headers', () => {
    const later = { ...project, id: 'project-0', name: 'acme', order: 0 }
    render(<ProjectTree projects={[project, later, folder]} />)

    expect(screen.queryByTestId('sidebar-folders-toggle')).toBeNull()
    expect(screen.queryByTestId('sidebar-projects-toggle')).toBeNull()
    expect(screen.queryByText('Folders')).toBeNull()

    // Folders first, then the projects in their saved order.
    const root = screen.getByTestId('sidebar-tree-items')
    const rows = Array.from(
      root.querySelectorAll(
        '[data-testid^="folder-"], [data-testid^="project-"]'
      )
    )
      .map(el => el.getAttribute('data-testid'))
      .filter(id => !id?.startsWith('project-body-'))
    expect(rows).toEqual([
      'folder-folder-1',
      'project-project-0',
      'project-project-1',
    ])
  })

  it('renders nothing for an empty tree', () => {
    const { container } = render(<ProjectTree projects={[]} />)
    expect(screen.queryByTestId('sidebar-tree-items')).toBeNull()
    expect(container.textContent).toBe('')
  })
})

describe('ProjectTree drop targets', () => {
  it("registers a folder's drop target on its row, not on its children", () => {
    dropTargetForElements.mockClear()
    const child = { ...project, id: 'child', parent_id: 'folder-1' }
    useProjectsStore.setState({ expandedFolderIds: new Set(['folder-1']) })
    render(<ProjectTree projects={[folder, child]} />)

    const elements = dropTargetForElements.mock.calls.map(
      ([args]) => args.element
    )
    const folderRow = screen.getByTestId('folder-folder-1')
    expect(elements).toContain(folderRow)
    // No target holds both rows: over the child, only the child answers.
    const childRow = screen.getByTestId('project-child')
    expect(
      elements.filter(el => el.contains(folderRow) && el.contains(childRow))
    ).toEqual([])
  })
})

describe('ProjectTree nesting', () => {
  it('marks rows inside a folder as nested and pads no wrapper', () => {
    const outer = { ...folder, id: 'outer' }
    const inner = { ...folder, id: 'inner', parent_id: 'outer' }
    const leaf = { ...project, id: 'leaf', parent_id: 'inner' }
    useProjectsStore.setState({
      expandedFolderIds: new Set(['outer', 'inner']),
    })
    const { container } = render(
      <ProjectTree projects={[outer, inner, leaf]} />
    )

    // The folder's hairline list indents its rows; a wrapper padding on top
    // would indent them twice.
    expect(container.querySelector('[style*="padding-left"]')).toBeNull()
    expect(screen.getByTestId('folder-outer')).toHaveAttribute(
      'data-nested',
      'false'
    )
    expect(screen.getByTestId('folder-inner')).toHaveAttribute(
      'data-nested',
      'true'
    )
    expect(screen.getByTestId('project-leaf')).toHaveAttribute(
      'data-nested',
      'true'
    )
  })
})
