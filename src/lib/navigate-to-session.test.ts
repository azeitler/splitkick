import { beforeEach, describe, expect, it } from 'vitest'
import { navigateToProject, navigateToSession } from './navigate-to-session'
import { queryClient } from './query-client'
import { projectsQueryKeys } from '@/services/projects'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import type { AllSessionsResponse, Session } from '@/types/chat'
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

describe('navigateToSession without a sidebar reveal', () => {
  const target = {
    projectId: 'project-1',
    worktreeId: 'wt-1',
    sessionId: 'session-1',
  }

  beforeEach(() => {
    queryClient.setQueryData(projectsQueryKeys.list(), [
      project('folder-outer'),
      project('project-1', 'folder-outer'),
    ])
    useProjectsStore.setState({
      selectedProjectId: 'project-1',
      selectedWorktreeId: 'wt-other',
      expandedProjectIds: new Set<string>(),
      expandedFolderIds: new Set<string>(),
      expandedWorktreeIds: new Set<string>(),
    })
    useUIStore.setState({
      pendingSidebarRevealId: null,
      pendingAutoOpenSessionIds: {},
    })
  })

  it('expands nothing in the tree', () => {
    navigateToSession(target, { revealInSidebar: false })

    const state = useProjectsStore.getState()
    expect(state.expandedProjectIds.size).toBe(0)
    expect(state.expandedWorktreeIds.size).toBe(0)
    expect(state.expandedFolderIds.size).toBe(0)
  })

  it('queues no scroll to the original row', () => {
    navigateToSession(target, { revealInSidebar: false })

    expect(useUIStore.getState().pendingSidebarRevealId).toBeNull()
  })

  it('still moves the selection onto the target workspace', () => {
    navigateToSession(target, { revealInSidebar: false })

    // Without this the old workspace would stay highlighted (#9).
    expect(useProjectsStore.getState().selectedWorktreeId).toBe('wt-1')
  })

  it('still opens the session', () => {
    navigateToSession(target, { revealInSidebar: false })

    expect(useUIStore.getState().pendingAutoOpenSessionIds).toEqual({
      'wt-1': 'session-1',
    })
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

// azeitler/jean#22: a project picked in CMD+K reopens the session the user
// last had open there, and falls back to the canvas whenever that session
// cannot be confirmed from data that is already loaded.
describe('navigateToProject with openLastSession', () => {
  const last = { worktreeId: 'wt-1', sessionId: 'session-1' }

  function session(id: string, archivedAt?: number): Session {
    return { id, name: id, archived_at: archivedAt } as Session
  }

  function seedAllSessions(sessions: Session[]) {
    queryClient.setQueryData<AllSessionsResponse>(['all-sessions'], {
      entries: [
        {
          project_id: 'project-1',
          project_name: 'project-1',
          worktree_id: 'wt-1',
          worktree_name: 'main',
          worktree_path: '/tmp/project-1',
          sessions,
        },
      ],
    })
  }

  beforeEach(() => {
    queryClient.clear()
    queryClient.setQueryData(projectsQueryKeys.list(), [project('project-1')])
    useProjectsStore.setState({
      selectedProjectId: null,
      selectedWorktreeId: null,
      expandedProjectIds: new Set<string>(),
      expandedFolderIds: new Set<string>(),
      expandedWorktreeIds: new Set<string>(),
    })
    useChatStore.setState({
      lastOpenedPerProject: { 'project-1': last },
    })
    useUIStore.setState({
      pendingSidebarRevealId: null,
      pendingAutoOpenSessionIds: {},
      autoOpenSessionWorktreeIds: new Set<string>(),
    })
  })

  function openedSession() {
    return useUIStore.getState().pendingAutoOpenSessionIds['wt-1']
  }

  function expectCanvasOnly() {
    expect(useProjectsStore.getState().selectedProjectId).toBe('project-1')
    expect(useUIStore.getState().pendingAutoOpenSessionIds).toEqual({})
    expect(useUIStore.getState().pendingSidebarRevealId).toBe(
      'project:project-1'
    )
  }

  it('opens the last session through the session path', () => {
    seedAllSessions([session('session-1')])

    navigateToProject('project-1', { openLastSession: true })

    expect(useProjectsStore.getState().selectedProjectId).toBe('project-1')
    expect(useProjectsStore.getState().selectedWorktreeId).toBe('wt-1')
    expect(openedSession()).toBe('session-1')
    expect(useUIStore.getState().pendingSidebarRevealId).toBe(
      'session:session-1'
    )
  })

  it('opens it in the project that is already current too', () => {
    seedAllSessions([session('session-1')])
    useProjectsStore.setState({ selectedProjectId: 'project-1' })

    navigateToProject('project-1', { openLastSession: true })

    expect(openedSession()).toBe('session-1')
  })

  it('shows the canvas when the project has no last session', () => {
    seedAllSessions([session('session-1')])
    useChatStore.setState({ lastOpenedPerProject: {} })

    navigateToProject('project-1', { openLastSession: true })

    expectCanvasOnly()
  })

  it('shows the canvas when the last session was archived', () => {
    seedAllSessions([session('session-1', 1_700_000_000)])

    navigateToProject('project-1', { openLastSession: true })

    expectCanvasOnly()
  })

  it('shows the canvas when the last session was deleted', () => {
    seedAllSessions([session('another-session')])

    navigateToProject('project-1', { openLastSession: true })

    expectCanvasOnly()
  })

  // Never guess: an unloaded list cannot confirm the session exists.
  it('shows the canvas when the session list is not loaded', () => {
    navigateToProject('project-1', { openLastSession: true })

    expectCanvasOnly()
  })

  // The worktree list leaves archived worktrees out.
  it('shows the canvas when the worktree was archived', () => {
    seedAllSessions([session('session-1')])
    queryClient.setQueryData(projectsQueryKeys.worktrees('project-1'), [
      { id: 'wt-other' },
    ])

    navigateToProject('project-1', { openLastSession: true })

    expectCanvasOnly()
  })

  // A project the sidebar never showed has no worktree list yet; the session
  // list alone is enough then.
  it('opens the session when the worktree list is not loaded', () => {
    seedAllSessions([session('session-1')])

    navigateToProject('project-1', { openLastSession: true })

    expect(openedSession()).toBe('session-1')
  })

  it('keeps the canvas-only behaviour without the option', () => {
    seedAllSessions([session('session-1')])

    navigateToProject('project-1')

    expectCanvasOnly()
  })
})
