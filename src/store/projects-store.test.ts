import { describe, it, expect, beforeEach } from 'vitest'
import { useProjectsStore } from './projects-store'

describe('ProjectsStore', () => {
  beforeEach(() => {
    useProjectsStore.setState({
      selectedProjectId: null,
      selectedWorktreeId: null,
      expandedProjectIds: new Set<string>(),
      expandedFolderIds: new Set<string>(),
      projectCanvasSettings: {},
      starredSessions: [],
      starredSectionCollapsed: false,
      githubDashboardFavoriteProjectIds: [],
      addProjectDialogOpen: false,
      projectSettingsDialogOpen: false,
      projectSettingsProjectId: null,
      gitInitModalOpen: false,
      gitInitModalPath: null,
      editingFolderId: null,
    })
  })

  describe('selection', () => {
    it('selects a project and clears worktree selection', () => {
      const { selectProject, selectWorktree } = useProjectsStore.getState()

      selectWorktree('worktree-1')
      expect(useProjectsStore.getState().selectedWorktreeId).toBe('worktree-1')

      selectProject('project-1')
      const state = useProjectsStore.getState()
      expect(state.selectedProjectId).toBe('project-1')
      expect(state.selectedWorktreeId).toBeNull()
    })

    it('selects a worktree', () => {
      const { selectWorktree } = useProjectsStore.getState()

      selectWorktree('worktree-1')
      expect(useProjectsStore.getState().selectedWorktreeId).toBe('worktree-1')
    })

    it('clears selection with null', () => {
      const { selectProject, selectWorktree } = useProjectsStore.getState()

      selectProject('project-1')
      selectWorktree('worktree-1')

      selectProject(null)
      expect(useProjectsStore.getState().selectedProjectId).toBeNull()

      selectWorktree(null)
      expect(useProjectsStore.getState().selectedWorktreeId).toBeNull()
    })
  })

  describe('project expansion', () => {
    it('toggles project expanded state', () => {
      const { toggleProjectExpanded } = useProjectsStore.getState()

      toggleProjectExpanded('project-1')
      expect(
        useProjectsStore.getState().expandedProjectIds.has('project-1')
      ).toBe(true)

      toggleProjectExpanded('project-1')
      expect(
        useProjectsStore.getState().expandedProjectIds.has('project-1')
      ).toBe(false)
    })

    it('expands project directly', () => {
      const { expandProject } = useProjectsStore.getState()

      expandProject('project-1')
      expect(
        useProjectsStore.getState().expandedProjectIds.has('project-1')
      ).toBe(true)

      // Expanding again should be idempotent
      expandProject('project-1')
      expect(
        useProjectsStore.getState().expandedProjectIds.has('project-1')
      ).toBe(true)
    })

    it('collapses project directly', () => {
      const { expandProject, collapseProject } = useProjectsStore.getState()

      expandProject('project-1')
      collapseProject('project-1')
      expect(
        useProjectsStore.getState().expandedProjectIds.has('project-1')
      ).toBe(false)

      // Collapsing non-expanded should be safe
      collapseProject('project-2')
      expect(
        useProjectsStore.getState().expandedProjectIds.has('project-2')
      ).toBe(false)
    })

    it('sets project expanded state explicitly', () => {
      const { setProjectExpanded } = useProjectsStore.getState()

      setProjectExpanded('project-1', true)
      expect(
        useProjectsStore.getState().expandedProjectIds.has('project-1')
      ).toBe(true)

      setProjectExpanded('project-1', false)
      expect(
        useProjectsStore.getState().expandedProjectIds.has('project-1')
      ).toBe(false)
    })

    it('handles multiple expanded projects', () => {
      const { expandProject } = useProjectsStore.getState()

      expandProject('project-1')
      expandProject('project-2')
      expandProject('project-3')

      const { expandedProjectIds } = useProjectsStore.getState()
      expect(expandedProjectIds.size).toBe(3)
      expect(expandedProjectIds.has('project-1')).toBe(true)
      expect(expandedProjectIds.has('project-2')).toBe(true)
      expect(expandedProjectIds.has('project-3')).toBe(true)
    })
  })

  describe('folder expansion', () => {
    it('toggles folder expanded state', () => {
      const { toggleFolderExpanded } = useProjectsStore.getState()

      toggleFolderExpanded('folder-1')
      expect(
        useProjectsStore.getState().expandedFolderIds.has('folder-1')
      ).toBe(true)

      toggleFolderExpanded('folder-1')
      expect(
        useProjectsStore.getState().expandedFolderIds.has('folder-1')
      ).toBe(false)
    })

    it('expands folder directly', () => {
      const { expandFolder } = useProjectsStore.getState()

      expandFolder('folder-1')
      expect(
        useProjectsStore.getState().expandedFolderIds.has('folder-1')
      ).toBe(true)
    })

    it('collapses folder directly', () => {
      const { expandFolder, collapseFolder } = useProjectsStore.getState()

      expandFolder('folder-1')
      collapseFolder('folder-1')
      expect(
        useProjectsStore.getState().expandedFolderIds.has('folder-1')
      ).toBe(false)
    })
  })

  describe('add project dialog', () => {
    it('opens and closes add project dialog', () => {
      const { setAddProjectDialogOpen } = useProjectsStore.getState()

      setAddProjectDialogOpen(true)
      expect(useProjectsStore.getState().addProjectDialogOpen).toBe(true)

      setAddProjectDialogOpen(false)
      expect(useProjectsStore.getState().addProjectDialogOpen).toBe(false)
    })
  })

  describe('project settings dialog', () => {
    it('opens project settings with project ID', () => {
      const { openProjectSettings } = useProjectsStore.getState()

      openProjectSettings('project-1')
      const state = useProjectsStore.getState()
      expect(state.projectSettingsDialogOpen).toBe(true)
      expect(state.projectSettingsProjectId).toBe('project-1')
    })

    it('closes project settings and clears project ID', () => {
      const { openProjectSettings, closeProjectSettings } =
        useProjectsStore.getState()

      openProjectSettings('project-1')
      closeProjectSettings()

      const state = useProjectsStore.getState()
      expect(state.projectSettingsDialogOpen).toBe(false)
      expect(state.projectSettingsProjectId).toBeNull()
    })
  })

  describe('git init modal', () => {
    it('opens git init modal with path', () => {
      const { openGitInitModal } = useProjectsStore.getState()

      openGitInitModal('/path/to/project')
      const state = useProjectsStore.getState()
      expect(state.gitInitModalOpen).toBe(true)
      expect(state.gitInitModalPath).toBe('/path/to/project')
    })

    it('closes git init modal and clears path', () => {
      const { openGitInitModal, closeGitInitModal } =
        useProjectsStore.getState()

      openGitInitModal('/path/to/project')
      closeGitInitModal()

      const state = useProjectsStore.getState()
      expect(state.gitInitModalOpen).toBe(false)
      expect(state.gitInitModalPath).toBeNull()
    })
  })

  describe('folder editing', () => {
    it('sets editing folder ID', () => {
      const { setEditingFolderId } = useProjectsStore.getState()

      setEditingFolderId('folder-1')
      expect(useProjectsStore.getState().editingFolderId).toBe('folder-1')

      setEditingFolderId(null)
      expect(useProjectsStore.getState().editingFolderId).toBeNull()
    })
  })

  describe('project canvas settings', () => {
    it('stores worktree sort mode per project', () => {
      const { setProjectCanvasWorktreeSortMode } = useProjectsStore.getState()

      setProjectCanvasWorktreeSortMode('project-1', 'last_activity')
      setProjectCanvasWorktreeSortMode('project-2', 'created')
      setProjectCanvasWorktreeSortMode('project-3', 'manual')

      const state = useProjectsStore.getState()
      expect(state.projectCanvasSettings['project-1']?.worktreeSortMode).toBe(
        'last_activity'
      )
      expect(state.projectCanvasSettings['project-2']?.worktreeSortMode).toBe(
        'created'
      )
      expect(state.projectCanvasSettings['project-3']?.worktreeSortMode).toBe(
        'manual'
      )
    })

    it('stores pinned label filters per project without changing sort mode', () => {
      const { setProjectCanvasWorktreeSortMode, setProjectCanvasPinnedLabels } =
        useProjectsStore.getState()

      setProjectCanvasWorktreeSortMode('project-1', 'manual')
      setProjectCanvasPinnedLabels('project-1', [
        { name: 'Bug', color: '#eab308', pinned: true },
      ])

      expect(
        useProjectsStore.getState().projectCanvasSettings['project-1']
      ).toEqual({
        worktreeSortMode: 'manual',
        pinnedLabels: [{ name: 'Bug', color: '#eab308', pinned: true }],
      })
    })
  })

  describe('session sort', () => {
    const settings = () =>
      useProjectsStore.getState().projectCanvasSettings['project-1']

    it('stores the mode and direction per project', () => {
      useProjectsStore
        .getState()
        .setProjectSessionSort('project-1', 'title', 'desc')

      expect(settings()?.sessionSortMode).toBe('title')
      expect(settings()?.sessionSortDirection).toBe('desc')
      expect(
        useProjectsStore.getState().projectCanvasSettings['project-2']
      ).toBeUndefined()
    })

    it('keeps the other canvas settings of the project', () => {
      const { pinSessionToProject, setProjectSessionSort } =
        useProjectsStore.getState()
      pinSessionToProject('project-1', 'session-a', 'worktree-1')

      setProjectSessionSort('project-1', 'last_activity', 'desc')

      expect(settings()?.pinnedSessions).toHaveLength(1)
    })

    // An unset mode already reads as default, so writing default must not hand
    // every subscriber a new settings object.
    it('treats default on an untouched project as a no-op', () => {
      const before = useProjectsStore.getState().projectCanvasSettings

      useProjectsStore
        .getState()
        .setProjectSessionSort('project-1', 'default', 'asc')

      expect(useProjectsStore.getState().projectCanvasSettings).toBe(before)
    })

    it('keeps the same reference when nothing changes', () => {
      const { setProjectSessionSort } = useProjectsStore.getState()
      setProjectSessionSort('project-1', 'title', 'asc')
      const before = useProjectsStore.getState().projectCanvasSettings

      setProjectSessionSort('project-1', 'title', 'asc')

      expect(useProjectsStore.getState().projectCanvasSettings).toBe(before)
    })

    it('records a direction change on the same mode', () => {
      const { setProjectSessionSort } = useProjectsStore.getState()
      setProjectSessionSort('project-1', 'title', 'asc')

      setProjectSessionSort('project-1', 'title', 'desc')

      expect(settings()?.sessionSortDirection).toBe('desc')
    })
  })

  describe('starred sessions', () => {
    const star = (sessionId: string, projectId = 'project-1') => ({
      projectId,
      worktreeId: `worktree-${sessionId}`,
      sessionId,
    })

    it('stars across projects in star order', () => {
      const { starSession } = useProjectsStore.getState()

      starSession(star('b', 'project-2'))
      starSession(star('a', 'project-1'))

      expect(
        useProjectsStore.getState().starredSessions.map(s => s.sessionId)
      ).toEqual(['b', 'a'])
    })

    it('keeps the same reference when the session is already starred', () => {
      const { starSession } = useProjectsStore.getState()
      starSession(star('a'))
      const before = useProjectsStore.getState().starredSessions

      starSession(star('a'))

      expect(useProjectsStore.getState().starredSessions).toBe(before)
    })

    it('unstars by session id', () => {
      const { starSession, unstarSession } = useProjectsStore.getState()
      starSession(star('a'))
      starSession(star('b'))

      unstarSession('a')

      expect(
        useProjectsStore.getState().starredSessions.map(s => s.sessionId)
      ).toEqual(['b'])
    })

    it('keeps the same reference when unstarring something never starred', () => {
      const before = useProjectsStore.getState().starredSessions

      useProjectsStore.getState().unstarSession('nope')

      expect(useProjectsStore.getState().starredSessions).toBe(before)
    })

    // A pin is local and a star is global; setting one must not touch the other.
    it('is independent of pinning', () => {
      const { pinSessionToProject, starSession, unstarSession } =
        useProjectsStore.getState()
      pinSessionToProject('project-1', 'a', 'worktree-a')
      starSession(star('a'))

      unstarSession('a')

      expect(
        useProjectsStore.getState().projectCanvasSettings['project-1']
          ?.pinnedSessions
      ).toHaveLength(1)
    })

    it('toggles the section and guards a no-op collapse', () => {
      const store = useProjectsStore.getState()
      store.toggleStarredSectionCollapsed()
      expect(useProjectsStore.getState().starredSectionCollapsed).toBe(true)

      const before = useProjectsStore.getState()
      useProjectsStore.getState().setStarredSectionCollapsed(true)
      expect(useProjectsStore.getState()).toBe(before)
    })
  })

  describe('pinned sessions', () => {
    it('pins a session with its worktree id, in pin order', () => {
      const { pinSessionToProject } = useProjectsStore.getState()

      pinSessionToProject('project-1', 'session-a', 'worktree-1')
      pinSessionToProject('project-1', 'session-b', 'worktree-2')

      expect(
        useProjectsStore.getState().projectCanvasSettings['project-1']
          ?.pinnedSessions
      ).toEqual([
        { sessionId: 'session-a', worktreeId: 'worktree-1' },
        { sessionId: 'session-b', worktreeId: 'worktree-2' },
      ])
    })

    it('keeps the same state reference when the session is already pinned', () => {
      const { pinSessionToProject } = useProjectsStore.getState()

      pinSessionToProject('project-1', 'session-a', 'worktree-1')
      const before = useProjectsStore.getState().projectCanvasSettings

      pinSessionToProject('project-1', 'session-a', 'worktree-1')

      expect(useProjectsStore.getState().projectCanvasSettings).toBe(before)
    })

    it('unpins only the target and leaves the other canvas settings alone', () => {
      const { pinSessionToProject, unpinSessionFromProject } =
        useProjectsStore.getState()

      useProjectsStore
        .getState()
        .setProjectCanvasWorktreeSortMode('project-1', 'last_activity')
      pinSessionToProject('project-1', 'session-a', 'worktree-1')
      pinSessionToProject('project-1', 'session-b', 'worktree-2')

      unpinSessionFromProject('project-1', 'session-a')

      const settings =
        useProjectsStore.getState().projectCanvasSettings['project-1']
      expect(settings?.pinnedSessions).toEqual([
        { sessionId: 'session-b', worktreeId: 'worktree-2' },
      ])
      expect(settings?.worktreeSortMode).toBe('last_activity')
    })

    it('keeps the same state reference when unpinning an unknown session', () => {
      const { pinSessionToProject, unpinSessionFromProject } =
        useProjectsStore.getState()

      pinSessionToProject('project-1', 'session-a', 'worktree-1')
      const before = useProjectsStore.getState().projectCanvasSettings

      unpinSessionFromProject('project-1', 'session-missing')

      expect(useProjectsStore.getState().projectCanvasSettings).toBe(before)
    })

    it('scopes pins per project', () => {
      const { pinSessionToProject } = useProjectsStore.getState()

      pinSessionToProject('project-1', 'session-a', 'worktree-1')
      pinSessionToProject('project-2', 'session-b', 'worktree-9')

      const settings = useProjectsStore.getState().projectCanvasSettings
      expect(settings['project-1']?.pinnedSessions).toEqual([
        { sessionId: 'session-a', worktreeId: 'worktree-1' },
      ])
      expect(settings['project-2']?.pinnedSessions).toEqual([
        { sessionId: 'session-b', worktreeId: 'worktree-9' },
      ])
    })
  })

  describe('GitHub dashboard favorites', () => {
    it('toggles favorite project IDs without duplicating them', () => {
      const { toggleGitHubDashboardFavoriteProject } =
        useProjectsStore.getState()

      toggleGitHubDashboardFavoriteProject('project-2')
      toggleGitHubDashboardFavoriteProject('project-1')
      toggleGitHubDashboardFavoriteProject('project-2')

      expect(
        useProjectsStore.getState().githubDashboardFavoriteProjectIds
      ).toEqual(['project-1'])
    })
  })
})
