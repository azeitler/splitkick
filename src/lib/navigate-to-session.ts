import { queryClient } from '@/lib/query-client'
import { projectsQueryKeys } from '@/services/projects'
import type { AllSessionsResponse } from '@/types/chat'
import type { Project, Worktree } from '@/types/projects'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'

export interface SessionNavigationTarget {
  projectId: string
  worktreeId: string
  sessionId: string
}

export interface SessionNavigationOptions {
  /**
   * Expand the target's folders, project and workspace, and scroll its row
   * into view. Defaults to true.
   *
   * Pass false from a shortcut row that already sits in the sidebar (Pinned,
   * Starred). A shortcut exists so the user does not have to find the session
   * in the tree; revealing the original row would scroll the tree away from
   * the row they clicked.
   */
  revealInSidebar?: boolean
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
 * The sidebar follows: the workspace is selected and, unless
 * `revealInSidebar` is false, the target's folders, project and workspace are
 * expanded and the session row is queued for a single scroll into view.
 */
export function navigateToSession(
  target: SessionNavigationTarget,
  { revealInSidebar = true }: SessionNavigationOptions = {}
): void {
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

  // Reveal the target in the sidebar.
  if (revealInSidebar) {
    expandAncestorFolders(target.projectId)
    expandProject(target.projectId)
    if (!expandedWorktreeIds.has(target.worktreeId)) {
      toggleWorktreeExpanded(target.worktreeId)
    }
  }
  // Always select, even without a reveal: `selectProject` clears the workspace
  // selection, and an unchanged project would keep the old workspace
  // highlighted. Selecting moves no row and expands nothing.
  selectWorktree(target.worktreeId)

  // Navigate to ProjectCanvasView (no-op if already there)
  clearActiveWorktree()
  setActiveSession(target.worktreeId, target.sessionId, { markOpened: false })
  setLastOpenedForProject(target.projectId, target.worktreeId, target.sessionId)

  // Queue auto-open via store so it survives lazy-mount + Suspense + remount.
  // ProjectCanvasView consumes pendingAutoOpenSessionIds in its own effect.
  const ui = useUIStore.getState()
  ui.markWorktreeForAutoOpenSession(target.worktreeId, target.sessionId)
  if (revealInSidebar) {
    ui.markSidebarReveal(sidebarRowId('session', target.sessionId))
  }
}

export interface ProjectNavigationOptions {
  /**
   * Open the session the user last opened in this project, when it still
   * exists. Falls back to the project canvas when there is none, or when it
   * was archived or deleted. Defaults to false.
   */
  openLastSession?: boolean
}

/**
 * The session to reopen for a project: the one the user last opened there,
 * if it is still live.
 *
 * `lastOpenedPerProject` outlives the session it names, and the canvas opens a
 * queued session without checking it exists - a stale target would open a
 * modal on nothing. So the target is checked against data that is already
 * loaded, and never waits for a fetch: the cross-project session list (the
 * command palette loads it while open), and the project's worktree list when
 * the sidebar has loaded it, since only that list leaves out archived
 * worktrees. Anything not confirmed returns null, and the caller shows the
 * canvas instead.
 */
export function resolveLastOpenedSession(
  projectId: string
): SessionNavigationTarget | null {
  const last = useChatStore.getState().lastOpenedPerProject[projectId]
  if (!last) return null

  const allSessions = queryClient.getQueryData<AllSessionsResponse>([
    'all-sessions',
  ])
  const entry = allSessions?.entries.find(
    e => e.project_id === projectId && e.worktree_id === last.worktreeId
  )
  const session = entry?.sessions.find(s => s.id === last.sessionId)
  if (!session || session.archived_at) return null

  const worktrees = queryClient.getQueryData<Worktree[]>(
    projectsQueryKeys.worktrees(projectId)
  )
  if (worktrees && !worktrees.some(w => w.id === last.worktreeId)) return null

  return { projectId, ...last }
}

/**
 * Switch to a project and let the sidebar follow.
 *
 * Used by the command palette's project results. By default no session opens:
 * the project's own subtree is left as the user had it, and only the folders
 * above it are opened, so the row can be seen. With `openLastSession`, the
 * session the user last opened there opens instead, through the same path as
 * a palette session result (azeitler/jean#22).
 */
export function navigateToProject(
  projectId: string,
  { openLastSession = false }: ProjectNavigationOptions = {}
): void {
  const target = openLastSession ? resolveLastOpenedSession(projectId) : null
  if (target) {
    navigateToSession(target)
    return
  }

  useChatStore.getState().clearActiveWorktree()
  useProjectsStore.getState().selectProject(projectId)
  expandAncestorFolders(projectId)
  useUIStore.getState().markSidebarReveal(sidebarRowId('project', projectId))
}
