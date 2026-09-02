import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@/test/test-utils'
import { ProjectTree } from './ProjectTree'
import type { Project } from '@/types/projects'
import { useProjectsStore } from '@/store/projects-store'

// Drag and drop is irrelevant here; every registration returns a no-op cleanup.
const noopCleanup = vi.hoisted(() => () => () => undefined)

vi.mock('@atlaskit/pragmatic-drag-and-drop/element/adapter', () => ({
  draggable: noopCleanup,
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
  ProjectTreeItem: ({ project }: { project: Project }) => (
    <div data-testid={`project-${project.id}`}>{project.name}</div>
  ),
}))

vi.mock('./FolderTreeItem', () => ({
  FolderTreeItem: ({ folder }: { folder: Project }) => (
    <div data-testid={`folder-${folder.id}`}>{folder.name}</div>
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
