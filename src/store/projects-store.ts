import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type { LabelData } from '@/types/chat'
import type {
  SessionSortMode,
  SortDirection,
  WorktreeSortMode,
} from '@/types/projects'

/**
 * A starred session. A star is global, unlike a pin, so it names its project:
 * the sidebar and Home resolve it without a selected project.
 */
export interface StarredSessionRef {
  projectId: string
  worktreeId: string
  sessionId: string
}

/** A session pinned to a project root. */
export interface PinnedSessionRef {
  sessionId: string
  worktreeId: string
}

export interface ProjectCanvasSettings {
  worktreeSortMode?: WorktreeSortMode
  pinnedLabels?: LabelData[]
  labels?: LabelData[]
  /** Sessions pinned to the project root, in pin order. */
  pinnedSessions?: PinnedSessionRef[]
  /** How the sidebar orders the sessions of each workspace. Unset = default. */
  sessionSortMode?: SessionSortMode
  sessionSortDirection?: SortDirection
}

interface ProjectsUIState {
  // Selection state
  selectedProjectId: string | null
  selectedWorktreeId: string | null

  // Expansion state for tree view (projects)
  expandedProjectIds: Set<string>

  // Expansion state for worktrees (sidebar session list)
  expandedWorktreeIds: Set<string>

  // Project IDs whose pinned-sessions row is expanded in the sidebar tree.
  // The row sits beside the workspace rows, so it keeps its own expansion.
  expandedPinnedProjectIds: Set<string>

  // Project IDs whose Graphs row (#99) is expanded in the sidebar tree.
  expandedGraphsProjectIds: Set<string>

  // Starred sessions, across every project, in star order
  starredSessions: StarredSessionRef[]
  // Whether the sidebar's Starred section is collapsed
  starredSectionCollapsed: boolean
  // Whether the sidebar's To-Do section is collapsed (#125)
  todoSectionCollapsed: boolean
  // Whether the sidebar's Graphs section is collapsed
  graphsSectionCollapsed: boolean
  // Whether graph detail panels show the expert layer ("Show details")
  graphDetailsShown: boolean
  // Whether graph detail panels show the "Relationships" foldout
  graphRelationsShown: boolean
  // Whether the sidebar's Folders and Projects sections are collapsed
  foldersSectionCollapsed: boolean
  projectsSectionCollapsed: boolean

  // Whether the project canvas hides its Home rail (recent sessions, activity,
  // open issues). Defaults to shown; the rail is the point of the project view.
  projectRailHidden: boolean

  // Dashboard worktree collapse overrides (list view): true=collapsed, false=expanded
  dashboardWorktreeCollapseOverrides: Record<string, boolean>

  // Expansion state for folders
  expandedFolderIds: Set<string>

  // Last-accessed timestamps per project (for recency sorting in command palette)
  projectAccessTimestamps: Record<string, number>

  // Project canvas settings per project
  projectCanvasSettings: Record<string, ProjectCanvasSettings>

  // Favorited projects shown first in the GitHub Dashboard filter and sections
  githubDashboardFavoriteProjectIds: string[]

  // Add project dialog state
  addProjectDialogOpen: boolean
  addProjectParentFolderId: string | null

  // Project settings dialog state
  projectSettingsDialogOpen: boolean
  projectSettingsProjectId: string | null
  projectSettingsInitialPane: string | null

  // Git init modal state
  gitInitModalOpen: boolean
  gitInitModalPath: string | null
  /** Choice preselected in the git init modal (#93) */
  gitInitModalChoice: 'plain' | 'git'
  /** Set when a plain project initializes git: switch it, don't add it */
  gitInitModalProjectId: string | null

  // Clone project modal state
  cloneModalOpen: boolean

  // Jean.json config wizard state
  jeanConfigWizardOpen: boolean
  jeanConfigWizardProjectId: string | null

  // Folder editing state (for auto-rename on create)
  editingFolderId: string | null

  // Actions
  selectProject: (id: string | null) => void
  selectWorktree: (id: string | null) => void
  toggleProjectExpanded: (id: string) => void
  setProjectExpanded: (id: string, expanded: boolean) => void
  expandProject: (id: string) => void
  collapseProject: (id: string) => void

  // Worktree expansion actions
  toggleWorktreeExpanded: (id: string) => void

  // Pinned-sessions row expansion, per project
  togglePinnedExpanded: (projectId: string) => void
  // Project Graphs row expansion, per project (#99)
  toggleProjectGraphsExpanded: (projectId: string) => void

  // Starred sessions
  starSession: (star: StarredSessionRef) => void
  unstarSession: (sessionId: string) => void
  setStarredSessions: (stars: StarredSessionRef[]) => void
  /** Move a star next to another one: above it, or below it. */
  moveStarredSession: (
    sessionId: string,
    targetSessionId: string,
    position: 'before' | 'after'
  ) => void
  toggleStarredSectionCollapsed: () => void
  setStarredSectionCollapsed: (collapsed: boolean) => void
  toggleTodoSectionCollapsed: () => void
  setTodoSectionCollapsed: (collapsed: boolean) => void
  toggleGraphsSectionCollapsed: () => void
  setGraphsSectionCollapsed: (collapsed: boolean) => void
  setGraphDetailsShown: (shown: boolean) => void
  setGraphRelationsShown: (shown: boolean) => void
  toggleFoldersSectionCollapsed: () => void
  setFoldersSectionCollapsed: (collapsed: boolean) => void
  toggleProjectsSectionCollapsed: () => void
  setProjectsSectionCollapsed: (collapsed: boolean) => void
  toggleProjectRailHidden: () => void
  setProjectRailHidden: (hidden: boolean) => void

  // Dashboard collapse actions
  toggleDashboardWorktreeCollapsed: (
    id: string,
    defaultCollapsed: boolean
  ) => void
  setDashboardWorktreeCollapseOverrides: (
    overrides: Record<string, boolean>
  ) => void

  // Folder expansion actions
  toggleFolderExpanded: (id: string) => void
  expandFolder: (id: string) => void
  collapseFolder: (id: string) => void

  // Bulk expansion actions
  expandAllFolders: (ids: string[]) => void
  collapseAllFolders: () => void
  expandAllProjects: (ids: string[]) => void
  collapseAllProjects: () => void

  setAddProjectDialogOpen: (
    open: boolean,
    parentFolderId?: string | null
  ) => void
  openProjectSettings: (projectId: string, pane?: string) => void
  closeProjectSettings: () => void
  /**
   * `choice` preselects "Add without git" (default) or "Initialize Git".
   * `projectId`: an existing plain project to switch to git after init.
   */
  openGitInitModal: (
    path: string,
    choice?: 'plain' | 'git',
    projectId?: string | null
  ) => void
  closeGitInitModal: () => void
  openCloneModal: () => void
  closeCloneModal: () => void
  openJeanConfigWizard: (projectId: string) => void
  closeJeanConfigWizard: () => void
  setEditingFolderId: (id: string | null) => void
  setProjectAccessTimestamps: (timestamps: Record<string, number>) => void
  setProjectCanvasSettings: (
    settings: Record<string, ProjectCanvasSettings>
  ) => void
  setProjectCanvasWorktreeSortMode: (
    projectId: string,
    sortMode: WorktreeSortMode
  ) => void
  setProjectCanvasPinnedLabels: (
    projectId: string,
    pinnedLabels: LabelData[]
  ) => void
  setProjectCanvasLabels: (projectId: string, labels: LabelData[]) => void
  setProjectSessionSort: (
    projectId: string,
    mode: SessionSortMode,
    direction: SortDirection
  ) => void
  pinSessionToProject: (
    projectId: string,
    sessionId: string,
    worktreeId: string
  ) => void
  unpinSessionFromProject: (projectId: string, sessionId: string) => void
  setGitHubDashboardFavoriteProjectIds: (projectIds: string[]) => void
  toggleGitHubDashboardFavoriteProject: (projectId: string) => void
}

export const useProjectsStore = create<ProjectsUIState>()(
  devtools(
    set => ({
      // Initial state
      selectedProjectId: null,
      selectedWorktreeId: null,
      expandedProjectIds: new Set<string>(),
      expandedWorktreeIds: new Set<string>(),
      expandedPinnedProjectIds: new Set<string>(),
      expandedGraphsProjectIds: new Set<string>(),
      starredSessions: [],
      starredSectionCollapsed: false,
      todoSectionCollapsed: false,
      graphsSectionCollapsed: false,
      graphDetailsShown: false,
      graphRelationsShown: false,
      foldersSectionCollapsed: false,
      projectsSectionCollapsed: false,
      projectRailHidden: false,
      dashboardWorktreeCollapseOverrides: {},
      expandedFolderIds: new Set<string>(),
      projectAccessTimestamps: {},
      projectCanvasSettings: {},
      githubDashboardFavoriteProjectIds: [],
      addProjectDialogOpen: false,
      addProjectParentFolderId: null,
      projectSettingsDialogOpen: false,
      projectSettingsProjectId: null,
      projectSettingsInitialPane: null,
      gitInitModalOpen: false,
      gitInitModalPath: null,
      gitInitModalChoice: 'plain',
      gitInitModalProjectId: null,
      cloneModalOpen: false,
      jeanConfigWizardOpen: false,
      jeanConfigWizardProjectId: null,
      editingFolderId: null,

      // Selection actions
      selectProject: id =>
        set(
          state => ({
            selectedProjectId: id,
            selectedWorktreeId: null,
            projectAccessTimestamps: id
              ? { ...state.projectAccessTimestamps, [id]: Date.now() }
              : state.projectAccessTimestamps,
          }),
          undefined,
          'selectProject'
        ),

      selectWorktree: id =>
        set(
          state =>
            state.selectedWorktreeId === id
              ? state
              : { selectedWorktreeId: id },
          undefined,
          'selectWorktree'
        ),

      // Expansion actions
      toggleProjectExpanded: id =>
        set(
          state => {
            const newSet = new Set(state.expandedProjectIds)
            if (newSet.has(id)) {
              newSet.delete(id)
            } else {
              newSet.add(id)
            }
            return { expandedProjectIds: newSet }
          },
          undefined,
          'toggleProjectExpanded'
        ),

      setProjectExpanded: (id, expanded) =>
        set(
          state => {
            if (state.expandedProjectIds.has(id) === expanded) return state
            const newSet = new Set(state.expandedProjectIds)
            if (expanded) {
              newSet.add(id)
            } else {
              newSet.delete(id)
            }
            return { expandedProjectIds: newSet }
          },
          undefined,
          'setProjectExpanded'
        ),

      expandProject: id =>
        set(
          state => {
            if (state.expandedProjectIds.has(id)) return state
            const newSet = new Set(state.expandedProjectIds)
            newSet.add(id)
            return { expandedProjectIds: newSet }
          },
          undefined,
          'expandProject'
        ),

      collapseProject: id =>
        set(
          state => {
            if (!state.expandedProjectIds.has(id)) return state
            const newSet = new Set(state.expandedProjectIds)
            newSet.delete(id)
            return { expandedProjectIds: newSet }
          },
          undefined,
          'collapseProject'
        ),

      // Worktree expansion actions
      toggleWorktreeExpanded: id =>
        set(
          state => {
            const newSet = new Set(state.expandedWorktreeIds)
            if (newSet.has(id)) {
              newSet.delete(id)
            } else {
              newSet.add(id)
            }
            return { expandedWorktreeIds: newSet }
          },
          undefined,
          'toggleWorktreeExpanded'
        ),

      starSession: star =>
        set(
          state =>
            // Guard: already starred, so keep the same reference.
            state.starredSessions.some(s => s.sessionId === star.sessionId)
              ? state
              : { starredSessions: [...state.starredSessions, star] },
          undefined,
          'starSession'
        ),

      unstarSession: sessionId =>
        set(
          state => {
            const next = state.starredSessions.filter(
              s => s.sessionId !== sessionId
            )
            // Guard: nothing was starred under that id.
            return next.length === state.starredSessions.length
              ? state
              : { starredSessions: next }
          },
          undefined,
          'unstarSession'
        ),

      setStarredSessions: stars =>
        set({ starredSessions: stars }, undefined, 'setStarredSessions'),

      moveStarredSession: (sessionId, targetSessionId, position) =>
        set(
          state => {
            const stars = state.starredSessions
            const moving = stars.find(s => s.sessionId === sessionId)
            if (!moving || sessionId === targetSessionId) return state
            const rest = stars.filter(s => s.sessionId !== sessionId)
            const targetIndex = rest.findIndex(
              s => s.sessionId === targetSessionId
            )
            if (targetIndex === -1) return state
            const insertAt =
              position === 'after' ? targetIndex + 1 : targetIndex
            const next = [
              ...rest.slice(0, insertAt),
              moving,
              ...rest.slice(insertAt),
            ]
            // Guard: dropped where it already was, so keep the same reference.
            return next.every((s, i) => s === stars[i])
              ? state
              : { starredSessions: next }
          },
          undefined,
          'moveStarredSession'
        ),

      toggleStarredSectionCollapsed: () =>
        set(
          state => ({
            starredSectionCollapsed: !state.starredSectionCollapsed,
          }),
          undefined,
          'toggleStarredSectionCollapsed'
        ),

      setStarredSectionCollapsed: collapsed =>
        set(
          state =>
            state.starredSectionCollapsed === collapsed
              ? state
              : { starredSectionCollapsed: collapsed },
          undefined,
          'setStarredSectionCollapsed'
        ),

      toggleTodoSectionCollapsed: () =>
        set(
          state => ({ todoSectionCollapsed: !state.todoSectionCollapsed }),
          undefined,
          'toggleTodoSectionCollapsed'
        ),

      setTodoSectionCollapsed: collapsed =>
        set(
          state =>
            state.todoSectionCollapsed === collapsed
              ? state
              : { todoSectionCollapsed: collapsed },
          undefined,
          'setTodoSectionCollapsed'
        ),

      setGraphRelationsShown: shown =>
        set(
          state =>
            state.graphRelationsShown === shown
              ? state
              : { graphRelationsShown: shown },
          undefined,
          'setGraphRelationsShown'
        ),

      setGraphDetailsShown: shown =>
        set(
          state =>
            state.graphDetailsShown === shown
              ? state
              : { graphDetailsShown: shown },
          undefined,
          'setGraphDetailsShown'
        ),

      toggleGraphsSectionCollapsed: () =>
        set(
          state => ({
            graphsSectionCollapsed: !state.graphsSectionCollapsed,
          }),
          undefined,
          'toggleGraphsSectionCollapsed'
        ),

      setGraphsSectionCollapsed: collapsed =>
        set(
          state =>
            state.graphsSectionCollapsed === collapsed
              ? state
              : { graphsSectionCollapsed: collapsed },
          undefined,
          'setGraphsSectionCollapsed'
        ),

      toggleFoldersSectionCollapsed: () =>
        set(
          state => ({
            foldersSectionCollapsed: !state.foldersSectionCollapsed,
          }),
          undefined,
          'toggleFoldersSectionCollapsed'
        ),

      setFoldersSectionCollapsed: collapsed =>
        set(
          state =>
            state.foldersSectionCollapsed === collapsed
              ? state
              : { foldersSectionCollapsed: collapsed },
          undefined,
          'setFoldersSectionCollapsed'
        ),

      toggleProjectsSectionCollapsed: () =>
        set(
          state => ({
            projectsSectionCollapsed: !state.projectsSectionCollapsed,
          }),
          undefined,
          'toggleProjectsSectionCollapsed'
        ),

      setProjectsSectionCollapsed: collapsed =>
        set(
          state =>
            state.projectsSectionCollapsed === collapsed
              ? state
              : { projectsSectionCollapsed: collapsed },
          undefined,
          'setProjectsSectionCollapsed'
        ),

      toggleProjectRailHidden: () =>
        set(
          state => ({ projectRailHidden: !state.projectRailHidden }),
          undefined,
          'toggleProjectRailHidden'
        ),

      setProjectRailHidden: hidden =>
        set(
          state =>
            state.projectRailHidden === hidden
              ? state
              : { projectRailHidden: hidden },
          undefined,
          'setProjectRailHidden'
        ),

      togglePinnedExpanded: projectId =>
        set(
          state => {
            const newSet = new Set(state.expandedPinnedProjectIds)
            if (newSet.has(projectId)) {
              newSet.delete(projectId)
            } else {
              newSet.add(projectId)
            }
            return { expandedPinnedProjectIds: newSet }
          },
          undefined,
          'togglePinnedExpanded'
        ),

      toggleProjectGraphsExpanded: projectId =>
        set(
          state => {
            const newSet = new Set(state.expandedGraphsProjectIds)
            if (newSet.has(projectId)) {
              newSet.delete(projectId)
            } else {
              newSet.add(projectId)
            }
            return { expandedGraphsProjectIds: newSet }
          },
          undefined,
          'toggleProjectGraphsExpanded'
        ),

      // Dashboard collapse actions
      toggleDashboardWorktreeCollapsed: (id, defaultCollapsed) =>
        set(
          state => {
            const current = state.dashboardWorktreeCollapseOverrides[id]
            const isCurrentlyCollapsed = current ?? defaultCollapsed
            return {
              dashboardWorktreeCollapseOverrides: {
                ...state.dashboardWorktreeCollapseOverrides,
                [id]: !isCurrentlyCollapsed,
              },
            }
          },
          undefined,
          'toggleDashboardWorktreeCollapsed'
        ),

      setDashboardWorktreeCollapseOverrides: overrides =>
        set(
          state =>
            state.dashboardWorktreeCollapseOverrides === overrides
              ? state
              : { dashboardWorktreeCollapseOverrides: overrides },
          undefined,
          'setDashboardWorktreeCollapseOverrides'
        ),

      setProjectCanvasSettings: settings =>
        set(
          state =>
            state.projectCanvasSettings === settings
              ? state
              : { projectCanvasSettings: settings },
          undefined,
          'setProjectCanvasSettings'
        ),

      setProjectCanvasWorktreeSortMode: (projectId, sortMode) =>
        set(
          state => {
            const currentSortMode =
              state.projectCanvasSettings[projectId]?.worktreeSortMode
            if (currentSortMode === sortMode) return state

            return {
              projectCanvasSettings: {
                ...state.projectCanvasSettings,
                [projectId]: {
                  ...state.projectCanvasSettings[projectId],
                  worktreeSortMode: sortMode,
                },
              },
            }
          },
          undefined,
          'setProjectCanvasWorktreeSortMode'
        ),

      setProjectCanvasPinnedLabels: (projectId, pinnedLabels) =>
        set(
          state => {
            const currentPinnedLabels =
              state.projectCanvasSettings[projectId]?.pinnedLabels ?? []
            if (
              JSON.stringify(currentPinnedLabels) ===
              JSON.stringify(pinnedLabels)
            ) {
              return state
            }

            return {
              projectCanvasSettings: {
                ...state.projectCanvasSettings,
                [projectId]: {
                  ...state.projectCanvasSettings[projectId],
                  pinnedLabels,
                },
              },
            }
          },
          undefined,
          'setProjectCanvasPinnedLabels'
        ),

      setProjectCanvasLabels: (projectId, labels) =>
        set(
          state => {
            const currentLabels =
              state.projectCanvasSettings[projectId]?.labels ?? []
            if (JSON.stringify(currentLabels) === JSON.stringify(labels)) {
              return state
            }

            return {
              projectCanvasSettings: {
                ...state.projectCanvasSettings,
                [projectId]: {
                  ...state.projectCanvasSettings[projectId],
                  labels,
                },
              },
            }
          },
          undefined,
          'setProjectCanvasLabels'
        ),

      setProjectSessionSort: (projectId, mode, direction) =>
        set(
          state => {
            const current = state.projectCanvasSettings[projectId]
            // Guard: an unset mode reads as default, so default-on-unset is a no-op.
            if (
              (current?.sessionSortMode ?? 'default') === mode &&
              (mode === 'default' ||
                current?.sessionSortDirection === direction)
            ) {
              return state
            }

            return {
              projectCanvasSettings: {
                ...state.projectCanvasSettings,
                [projectId]: {
                  ...current,
                  sessionSortMode: mode,
                  sessionSortDirection: direction,
                },
              },
            }
          },
          undefined,
          'setProjectSessionSort'
        ),

      pinSessionToProject: (projectId, sessionId, worktreeId) =>
        set(
          state => {
            const current =
              state.projectCanvasSettings[projectId]?.pinnedSessions ?? []
            // Guard: already pinned, so keep the same reference.
            if (current.some(pin => pin.sessionId === sessionId)) return state

            return {
              projectCanvasSettings: {
                ...state.projectCanvasSettings,
                [projectId]: {
                  ...state.projectCanvasSettings[projectId],
                  pinnedSessions: [...current, { sessionId, worktreeId }],
                },
              },
            }
          },
          undefined,
          'pinSessionToProject'
        ),

      unpinSessionFromProject: (projectId, sessionId) =>
        set(
          state => {
            const current =
              state.projectCanvasSettings[projectId]?.pinnedSessions ?? []
            const next = current.filter(pin => pin.sessionId !== sessionId)
            // Guard: nothing was pinned under that id.
            if (next.length === current.length) return state

            return {
              projectCanvasSettings: {
                ...state.projectCanvasSettings,
                [projectId]: {
                  ...state.projectCanvasSettings[projectId],
                  pinnedSessions: next,
                },
              },
            }
          },
          undefined,
          'unpinSessionFromProject'
        ),

      setGitHubDashboardFavoriteProjectIds: projectIds =>
        set(
          state =>
            state.githubDashboardFavoriteProjectIds === projectIds
              ? state
              : { githubDashboardFavoriteProjectIds: projectIds },
          undefined,
          'setGitHubDashboardFavoriteProjectIds'
        ),

      toggleGitHubDashboardFavoriteProject: projectId =>
        set(
          state => {
            const current = state.githubDashboardFavoriteProjectIds
            if (current.includes(projectId)) {
              return {
                githubDashboardFavoriteProjectIds: current.filter(
                  id => id !== projectId
                ),
              }
            }

            return {
              githubDashboardFavoriteProjectIds: [...current, projectId],
            }
          },
          undefined,
          'toggleGitHubDashboardFavoriteProject'
        ),

      // Folder expansion actions
      toggleFolderExpanded: id =>
        set(
          state => {
            const newSet = new Set(state.expandedFolderIds)
            if (newSet.has(id)) {
              newSet.delete(id)
            } else {
              newSet.add(id)
            }
            return { expandedFolderIds: newSet }
          },
          undefined,
          'toggleFolderExpanded'
        ),

      expandFolder: id =>
        set(
          state => {
            if (state.expandedFolderIds.has(id)) return state
            const newSet = new Set(state.expandedFolderIds)
            newSet.add(id)
            return { expandedFolderIds: newSet }
          },
          undefined,
          'expandFolder'
        ),

      collapseFolder: id =>
        set(
          state => {
            if (!state.expandedFolderIds.has(id)) return state
            const newSet = new Set(state.expandedFolderIds)
            newSet.delete(id)
            return { expandedFolderIds: newSet }
          },
          undefined,
          'collapseFolder'
        ),

      // Bulk expansion actions
      expandAllFolders: ids =>
        set(
          () => ({ expandedFolderIds: new Set(ids) }),
          undefined,
          'expandAllFolders'
        ),

      collapseAllFolders: () =>
        set(
          state =>
            state.expandedFolderIds.size === 0
              ? state
              : { expandedFolderIds: new Set<string>() },
          undefined,
          'collapseAllFolders'
        ),

      expandAllProjects: ids =>
        set(
          () => ({ expandedProjectIds: new Set(ids) }),
          undefined,
          'expandAllProjects'
        ),

      collapseAllProjects: () =>
        set(
          state =>
            state.expandedProjectIds.size === 0
              ? state
              : { expandedProjectIds: new Set<string>() },
          undefined,
          'collapseAllProjects'
        ),

      // Dialog actions
      setAddProjectDialogOpen: (open, parentFolderId) =>
        set(
          {
            addProjectDialogOpen: open,
            addProjectParentFolderId: open ? (parentFolderId ?? null) : null,
          },
          undefined,
          'setAddProjectDialogOpen'
        ),

      openProjectSettings: (projectId, pane) =>
        set(
          {
            projectSettingsDialogOpen: true,
            projectSettingsProjectId: projectId,
            projectSettingsInitialPane: pane ?? null,
          },
          undefined,
          'openProjectSettings'
        ),

      closeProjectSettings: () =>
        set(
          {
            projectSettingsDialogOpen: false,
            projectSettingsProjectId: null,
            projectSettingsInitialPane: null,
          },
          undefined,
          'closeProjectSettings'
        ),

      openGitInitModal: (path, choice = 'plain', projectId = null) =>
        set(
          {
            gitInitModalOpen: true,
            gitInitModalPath: path,
            gitInitModalChoice: choice,
            gitInitModalProjectId: projectId,
          },
          undefined,
          'openGitInitModal'
        ),

      closeGitInitModal: () =>
        set(
          {
            gitInitModalOpen: false,
            gitInitModalPath: null,
            gitInitModalProjectId: null,
          },
          undefined,
          'closeGitInitModal'
        ),

      openCloneModal: () =>
        set(
          state => (state.cloneModalOpen ? state : { cloneModalOpen: true }),
          undefined,
          'openCloneModal'
        ),

      closeCloneModal: () =>
        set(
          state => (state.cloneModalOpen ? { cloneModalOpen: false } : state),
          undefined,
          'closeCloneModal'
        ),

      openJeanConfigWizard: projectId =>
        set(
          { jeanConfigWizardOpen: true, jeanConfigWizardProjectId: projectId },
          undefined,
          'openJeanConfigWizard'
        ),

      closeJeanConfigWizard: () =>
        set(
          { jeanConfigWizardOpen: false, jeanConfigWizardProjectId: null },
          undefined,
          'closeJeanConfigWizard'
        ),

      setEditingFolderId: id =>
        set(
          state =>
            state.editingFolderId === id ? state : { editingFolderId: id },
          undefined,
          'setEditingFolderId'
        ),

      setProjectAccessTimestamps: timestamps =>
        set(
          state =>
            state.projectAccessTimestamps === timestamps
              ? state
              : { projectAccessTimestamps: timestamps },
          undefined,
          'setProjectAccessTimestamps'
        ),
    }),
    {
      name: 'projects-store',
    }
  )
)
