import { beforeEach, describe, expect, it } from 'vitest'
import { navigateToProject, navigateToSession } from './navigate-to-session'
import { queryClient } from './query-client'
import { projectsQueryKeys } from '@/services/projects'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import type { Project } from '@/types/projects'

function project(id: string, parentId?: string): Project {
  return {
    id,
    name: id,
    path: `/tmp/${id}`,
    default_branch: 'main',
    added_at: 0,
    order: 0,
    parent_id: parentId,
  } as Project
}

describe('navigateToSession sidebar follow', () => {
  beforeEach(() => {
    queryClient.setQueryData(projectsQueryKeys.list(), [
      project('folder-outer'),
      project('folder-inner', 'folder-outer'),
      project('project-1', 'folder-inner'),
    ])
    useProjectsStore.setState({
      selectedProjectId: null,
      selectedWorktreeId: null,
      expandedProjectIds: new Set<string>(),
      expandedFolderIds: new Set<string>(),
      expandedWorktreeIds: new Set<string>(),
    })
    useUIStore.setState({ pendingSidebarRevealId: null })
  })

  it('selects the workspace instead of clearing the selection', () => {
    navigateToSession({
      projectId: 'project-1',
      worktreeId: 'wt-1',
      sessionId: 'session-1',
    })

    // selectProject clears the workspace selection, so the target has to be
    // put back afterwards or the sidebar shows no selection at all.
    expect(useProjectsStore.getState().selectedWorktreeId).toBe('wt-1')
    expect(useProjectsStore.getState().selectedProjectId).toBe('project-1')
  })

  it('expands the target project, workspace and every folder above them', () => {
    navigateToSession({
      projectId: 'project-1',
      worktreeId: 'wt-1',
      sessionId: 'session-1',
    })

    const state = useProjectsStore.getState()
    expect(state.expandedProjectIds.has('project-1')).toBe(true)
    expect(state.expandedWorktreeIds.has('wt-1')).toBe(true)
    expect(state.expandedFolderIds.has('folder-inner')).toBe(true)
    expect(state.expandedFolderIds.has('folder-outer')).toBe(true)
  })

  it('leaves an already expanded workspace open', () => {
    useProjectsStore.setState({ expandedWorktreeIds: new Set(['wt-1']) })

    navigateToSession({
      projectId: 'project-1',
      worktreeId: 'wt-1',
      sessionId: 'session-1',
    })

    expect(useProjectsStore.getState().expandedWorktreeIds.has('wt-1')).toBe(
      true
    )
  })

  it('queues the session row for a single reveal', () => {
    navigateToSession({
      projectId: 'project-1',
      worktreeId: 'wt-1',
      sessionId: 'session-1',
    })

    expect(useUIStore.getState().pendingSidebarRevealId).toBe(
      'session:session-1'
    )
  })
})

describe('navigateToProject', () => {
  beforeEach(() => {
    queryClient.setQueryData(projectsQueryKeys.list(), [
      project('folder-outer'),
      project('project-1', 'folder-outer'),
    ])
    useProjectsStore.setState({
      selectedProjectId: null,
      expandedProjectIds: new Set<string>(),
      expandedFolderIds: new Set<string>(),
    })
    useUIStore.setState({ pendingSidebarRevealId: null })
  })

  it('opens the folders above the project and reveals its row', () => {
    navigateToProject('project-1')

    expect(useProjectsStore.getState().selectedProjectId).toBe('project-1')
    expect(
      useProjectsStore.getState().expandedFolderIds.has('folder-outer')
    ).toBe(true)
    expect(useUIStore.getState().pendingSidebarRevealId).toBe(
      'project:project-1'
    )
  })

  it('leaves the project subtree as the user had it', () => {
    navigateToProject('project-1')

    expect(
      useProjectsStore.getState().expandedProjectIds.has('project-1')
    ).toBe(false)
  })
})
