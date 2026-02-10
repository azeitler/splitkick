import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

interface ProjectsUIState {
  // Selection state
  selectedProjectId: string | null
  selectedWorktreeId: string | null

  // Expansion state for tree view (projects)
  expandedProjectIds: Set<string>

  // Expansion state for folders
  expandedFolderIds: Set<string>

  // Last-accessed timestamps per project (for recency sorting in command palette)
  projectAccessTimestamps: Record<string, number>

  // Add project dialog state
  addProjectDialogOpen: boolean
  addProjectParentFolderId: string | null

  // Project settings dialog state
  projectSettingsDialogOpen: boolean
  projectSettingsProjectId: string | null

  // Git init modal state
  gitInitModalOpen: boolean
  gitInitModalPath: string | null

  // Folder editing state (for auto-rename on create)
  editingFolderId: string | null

  // Actions
  selectProject: (id: string | null) => void
  selectWorktree: (id: string | null) => void
  toggleProjectExpanded: (id: string) => void
  setProjectExpanded: (id: string, expanded: boolean) => void
  expandProject: (id: string) => void
  collapseProject: (id: string) => void

  // Folder expansion actions
  toggleFolderExpanded: (id: string) => void
  expandFolder: (id: string) => void
  collapseFolder: (id: string) => void

  setAddProjectDialogOpen: (
    open: boolean,
    parentFolderId?: string | null
  ) => void
  openProjectSettings: (projectId: string) => void
  closeProjectSettings: () => void
  openGitInitModal: (path: string) => void
  closeGitInitModal: () => void
  setEditingFolderId: (id: string | null) => void
  setProjectAccessTimestamps: (timestamps: Record<string, number>) => void
}

export const useProjectsStore = create<ProjectsUIState>()(
  devtools(
    set => ({
      // Initial state
      selectedProjectId: null,
      selectedWorktreeId: null,
      expandedProjectIds: new Set<string>(),
      expandedFolderIds: new Set<string>(),
      projectAccessTimestamps: {},
      addProjectDialogOpen: false,
      addProjectParentFolderId: null,
      projectSettingsDialogOpen: false,
      projectSettingsProjectId: null,
      gitInitModalOpen: false,
      gitInitModalPath: null,
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
        set({ selectedWorktreeId: id }, undefined, 'selectWorktree'),

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
            const newSet = new Set(state.expandedProjectIds)
            newSet.delete(id)
            return { expandedProjectIds: newSet }
          },
          undefined,
          'collapseProject'
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
            const newSet = new Set(state.expandedFolderIds)
            newSet.delete(id)
            return { expandedFolderIds: newSet }
          },
          undefined,
          'collapseFolder'
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

      openProjectSettings: projectId =>
        set(
          {
            projectSettingsDialogOpen: true,
            projectSettingsProjectId: projectId,
          },
          undefined,
          'openProjectSettings'
        ),

      closeProjectSettings: () =>
        set(
          { projectSettingsDialogOpen: false, projectSettingsProjectId: null },
          undefined,
          'closeProjectSettings'
        ),

      openGitInitModal: path =>
        set(
          { gitInitModalOpen: true, gitInitModalPath: path },
          undefined,
          'openGitInitModal'
        ),

      closeGitInitModal: () =>
        set(
          { gitInitModalOpen: false, gitInitModalPath: null },
          undefined,
          'closeGitInitModal'
        ),

      setEditingFolderId: id =>
        set({ editingFolderId: id }, undefined, 'setEditingFolderId'),

      setProjectAccessTimestamps: timestamps =>
        set(
          { projectAccessTimestamps: timestamps },
          undefined,
          'setProjectAccessTimestamps'
        ),
    }),
    {
      name: 'projects-store',
    }
  )
)
