import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@/test/test-utils'
import { ProjectTree } from './ProjectTree'
import type { Project } from '@/types/projects'
import { useProjectsStore } from '@/store/projects-store'

// Drag and drop is irrelevant here; every registration returns a no-op cleanup.
const noopCleanup = vi.hoisted(() => () => () => undefined)
const draggable = vi.hoisted(() =>
  vi.fn((_args: { element: Element; dragHandle?: Element }) => () => undefined)
)

vi.mock('@atlaskit/pragmatic-drag-and-drop/element/adapter', () => ({
  draggable,
  dropTargetForElements: noopCleanup,
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

describe('ProjectTree bulk expand toggle', () => {
  beforeEach(() => {
    useProjectsStore.setState({
      expandedProjectIds: new Set(),
      expandedFolderIds: new Set(),
    })
  })

  it('offers expand while the section is fully collapsed', async () => {
    const user = userEvent.setup()
    render(<ProjectTree projects={projects} />)

    expect(
      screen.queryByRole('button', { name: 'Collapse all projects' })
    ).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'Expand all projects' })
    )

    expect(useProjectsStore.getState().expandedProjectIds).toEqual(
      new Set(['project-1'])
    )
  })

  it('switches to collapse once something in the section is expanded', async () => {
    const user = userEvent.setup()
    useProjectsStore.setState({ expandedProjectIds: new Set(['project-1']) })
    render(<ProjectTree projects={projects} />)

    expect(
      screen.queryByRole('button', { name: 'Expand all projects' })
    ).not.toBeInTheDocument()

    await user.click(
      screen.getByRole('button', { name: 'Collapse all projects' })
    )

    expect(useProjectsStore.getState().expandedProjectIds.size).toBe(0)
  })

  it('toggles folders independently of projects', async () => {
    const user = userEvent.setup()
    useProjectsStore.setState({ expandedProjectIds: new Set(['project-1']) })
    render(<ProjectTree projects={projects} />)

    // Projects are expanded, folders are not — each header shows its own action
    screen.getByRole('button', { name: 'Collapse all projects' })
    await user.click(screen.getByRole('button', { name: 'Expand all folders' }))

    const state = useProjectsStore.getState()
    expect(state.expandedFolderIds).toEqual(new Set(['folder-1']))
    expect(state.expandedProjectIds).toEqual(new Set(['project-1']))
  })
})

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

describe('ProjectTree sections', () => {
  beforeEach(() => {
    useProjectsStore.setState({
      expandedProjectIds: new Set(),
      expandedFolderIds: new Set(),
      foldersSectionCollapsed: false,
      projectsSectionCollapsed: false,
    })
  })

  it('renders the Folders section above the Projects section', () => {
    render(<ProjectTree projects={projects} />)

    const folders = screen.getByTestId('sidebar-folders-toggle')
    const projectsToggle = screen.getByTestId('sidebar-projects-toggle')
    expect(
      folders.compareDocumentPosition(projectsToggle) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(folders).toHaveAttribute('aria-expanded', 'true')
    expect(projectsToggle).toHaveAttribute('aria-expanded', 'true')
  })

  it('gives the Folders header its own icon, not the folder-row icon', () => {
    render(<ProjectTree projects={projects} />)

    const icon = screen
      .getByTestId('sidebar-folders-toggle')
      .querySelector('svg')
    expect(icon).toHaveClass('lucide-folders')
    expect(icon).not.toHaveClass('lucide-folder')
  })

  it('indents the rows of both sections one step in from their header', () => {
    render(<ProjectTree projects={projects} />)

    const folders = screen.getByTestId('sidebar-folders-items')
    const projectRows = screen.getByTestId('sidebar-projects-items')
    expect(folders).toHaveStyle({ paddingLeft: '16px' })
    expect(projectRows).toHaveStyle({ paddingLeft: '16px' })
    expect(folders).toContainElement(screen.getByTestId('folder-folder-1'))
    expect(projectRows).toContainElement(
      screen.getByTestId('project-project-1')
    )
  })

  it('puts the section header glyphs on the Home row column', () => {
    render(<ProjectTree projects={projects} />)

    for (const id of ['sidebar-folders-toggle', 'sidebar-projects-toggle']) {
      // With actions, the padding sits on the wrapper around the toggle.
      expect(screen.getByTestId(id).parentElement).toHaveClass('pl-4')
    }
  })

  it('collapses Folders and shows the folder count', async () => {
    const user = userEvent.setup()
    render(<ProjectTree projects={projects} />)

    await user.click(screen.getByTestId('sidebar-folders-toggle'))

    expect(useProjectsStore.getState().foldersSectionCollapsed).toBe(true)
    expect(screen.queryByTestId('folder-folder-1')).not.toBeInTheDocument()
    expect(screen.getByLabelText('1 folder')).toBeInTheDocument()
    // The other section stays open.
    expect(screen.getByTestId('project-project-1')).toBeInTheDocument()
  })

  it('collapses Projects and shows the project count', async () => {
    const user = userEvent.setup()
    render(<ProjectTree projects={projects} />)

    await user.click(screen.getByTestId('sidebar-projects-toggle'))

    expect(useProjectsStore.getState().projectsSectionCollapsed).toBe(true)
    expect(screen.queryByTestId('project-project-1')).not.toBeInTheDocument()
    expect(screen.getByLabelText('1 project')).toBeInTheDocument()
  })

  it('keeps both headers and their New buttons when the tree is empty', async () => {
    const user = userEvent.setup()
    const onNewFolder = vi.fn()
    const onNewProject = vi.fn()
    render(
      <ProjectTree
        projects={[]}
        onNewFolder={onNewFolder}
        onNewProject={onNewProject}
      />
    )

    await user.click(screen.getByRole('button', { name: 'New folder' }))
    await user.click(screen.getByRole('button', { name: 'New project' }))

    expect(onNewFolder).toHaveBeenCalledOnce()
    expect(onNewProject).toHaveBeenCalledOnce()
  })

  it('disables New project while setup is incomplete', () => {
    render(
      <ProjectTree
        projects={projects}
        onNewFolder={vi.fn()}
        onNewProject={vi.fn()}
        newProjectDisabled
      />
    )

    expect(screen.getByRole('button', { name: 'New project' })).toBeDisabled()
  })
})

describe('ProjectTree nesting', () => {
  it('marks rows inside a folder as nested and pads no wrapper', () => {
    const outer = { ...folder, id: 'outer' }
    const inner = { ...folder, id: 'inner', parent_id: 'outer' }
    const leaf = { ...project, id: 'leaf', parent_id: 'inner' }
    useProjectsStore.setState({
      expandedFolderIds: new Set(['outer', 'inner']),
      foldersSectionCollapsed: false,
    })
    render(<ProjectTree projects={[outer, inner, leaf]} />)

    // The folder's hairline list indents its rows; a wrapper padding on top
    // would indent them twice.
    for (const id of ['folder-outer', 'folder-inner', 'project-leaf']) {
      const wrapper = screen
        .getByTestId(id)
        .closest('[data-pdnd-tree-id]') as HTMLElement
      expect(wrapper.style.paddingLeft).toBe('')
    }
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
