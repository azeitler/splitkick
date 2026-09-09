import { queryClient } from '@/lib/query-client'
import { projectsQueryKeys } from '@/services/projects'
import type { Project } from '@/types/projects'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'

export interface SessionNavigationTarget {
  projectId: string
  worktreeId: string
  sessionId: string
}

/** `data-sidebar-row-id` of a tree row, so a reveal can find it in the DOM. */
export function sidebarRowId(kind: 'project' | 'session', id: string): string {
  return `${kind}:${id}`
}

/**
 * Expand every folder above a project, so its row exists in the tree.
 *
 * Reads the projects list straight from the query cache: navigation happens
 * outside React, and the list is already loaded whenever the sidebar is up.
 */
function expandAncestorFolders(projectId: string): void {
  const projects = queryClient.getQueryData<Project[]>(projectsQueryKeys.list())
  if (!projects) return

  const byId = new Map(projects.map(project => [project.id, project]))
  const { expandFolder } = useProjectsStore.getState()

  let parentId = byId.get(projectId)?.parent_id
  const seen = new Set<string>()
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId)
    expandFolder(parentId)
    parentId = byId.get(parentId)?.parent_id
  }
}

/**
 * Open a session from anywhere in the app, including from a different project.
 *
 * Shared by the unread bell, the home view and the command palette. The target
 * project's canvas may not be mounted yet, so the auto-open is queued through
 * the UI store rather than dispatched as a DOM event.
 *
 * The sidebar follows: the target's folders, project and workspace are
 * expanded, the workspace is selected, and the session row is queued for a
 * single scroll into view.
 */
export function navigateToSession(target: SessionNavigationTarget): void {
  const {
    selectedProjectId,
    selectProject,
    selectWorktree,
    expandProject,
    expandedWorktreeIds,
    toggleWorktreeExpanded,
  } = useProjectsStore.getState()
  const { setActiveSession, clearActiveWorktree, setLastOpenedForProject } =
    useChatStore.getState()

  if (selectedProjectId !== target.projectId) {
    selectProject(target.projectId)
  }

  // Reveal the target in the sidebar. `selectProject` clears the workspace
  // selection, so the selection is moved back onto the target afterwards.
  expandAncestorFolders(target.projectId)
  expandProject(target.projectId)
  if (!expandedWorktreeIds.has(target.worktreeId)) {
    toggleWorktreeExpanded(target.worktreeId)
  }
  selectWorktree(target.worktreeId)

  // Navigate to ProjectCanvasView (no-op if already there)
  clearActiveWorktree()
  setActiveSession(target.worktreeId, target.sessionId, { markOpened: false })
  setLastOpenedForProject(target.projectId, target.worktreeId, target.sessionId)

  // Queue auto-open via store so it survives lazy-mount + Suspense + remount.
  // ProjectCanvasView consumes pendingAutoOpenSessionIds in its own effect.
  const ui = useUIStore.getState()
  ui.markWorktreeForAutoOpenSession(target.worktreeId, target.sessionId)
  ui.markSidebarReveal(sidebarRowId('session', target.sessionId))
}

/**
 * Switch to a project and let the sidebar follow, without opening a session.
 *
 * Used by the command palette's project results. The project's own subtree is
 * left as the user had it — only the folders above it are opened, so the row
 * can be seen.
 */
export function navigateToProject(projectId: string): void {
  useChatStore.getState().clearActiveWorktree()
  useProjectsStore.getState().selectProject(projectId)
  expandAncestorFolders(projectId)
  useUIStore.getState().markSidebarReveal(sidebarRowId('project', projectId))
}
