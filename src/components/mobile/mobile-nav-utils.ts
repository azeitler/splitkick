import type { AllSessionsEntry } from '@/types/chat'
import { isFolder, type Project } from '@/types/projects'
import { toMilliseconds } from '@/lib/relative-time'
import { navigateToProject } from '@/lib/navigate-to-session'
import { useUIStore } from '@/store/ui-store'
import { isUnreadSession } from '@/components/unread/unread-utils'
import {
  flattenAllSessions,
  type HomeSessionEntry,
} from '@/components/home/home-utils'

/**
 * Every session the user has opened, most recently opened first — the History
 * tab.
 *
 * Ordered by `last_opened_at`, not by activity: History answers "where was I?",
 * so a session an agent kept writing to while you looked elsewhere must not
 * jump to the top. Sessions never opened (created over MCP, for example) are
 * left out.
 *
 * `activityAt` is replaced with the open time, because it is the time the row
 * shows and the list must read in the order it is sorted.
 */
export function recentlyOpenedSessions(
  entries: readonly AllSessionsEntry[]
): HomeSessionEntry[] {
  const rows: HomeSessionEntry[] = []
  for (const row of flattenAllSessions(entries)) {
    const openedAt = row.session.last_opened_at
    if (openedAt == null) continue
    rows.push({ ...row, activityAt: toMilliseconds(openedAt) })
  }
  return rows.sort((a, b) => b.activityAt - a.activityAt)
}

/**
 * Sessions that finished (or wait for you) since you last looked, newest
 * activity first — the Home tab's Unread list.
 *
 * The same rule as the desktop unread bell (`isUnreadSession`), so the Home
 * badge and the bell always agree.
 */
export function unreadSessions(
  entries: readonly AllSessionsEntry[]
): HomeSessionEntry[] {
  return flattenAllSessions(entries).filter(row => isUnreadSession(row.session))
}

/**
 * Whether an app, server or CLI update waits. These used to be title-bar
 * badges; on a phone they sit in the Settings tab, and this lights its dot.
 */
export function useHasPendingUpdate(): boolean {
  return useUIStore(
    state =>
      state.availableCliUpdates.length > 0 ||
      !!state.pendingServerUpdate ||
      !!state.pendingUpdateVersion ||
      !!state.updateReadyVersion ||
      state.isUpdateInstalling
  )
}

/** Projects under one heading on the Home tab. `folder` is null at the root. */
export interface ProjectGroup {
  /** Stable key for the group. */
  id: string
  /** The folder path, e.g. `Clients / Acme`; null for projects at the root. */
  title: string | null
  projects: Project[]
}

/**
 * Projects grouped by the folder they sit in, for the Home tab.
 *
 * The drawer used to be the only folder UI on a phone. The tab keeps the
 * grouping so a large project list stays navigable, and leaves folder
 * management (create, rename, drag) to the desktop. A nested folder is shown
 * as one heading with its full path rather than as a tree.
 *
 * Same order as the sidebar tree (`ProjectTree`): folders first, nested
 * folders right after their parent, then the projects at the root; each list
 * by its `order`. Folders with no projects are dropped: on a phone they are a
 * heading over nothing.
 */
export function groupProjectsByFolder(
  entries: readonly Project[]
): ProjectGroup[] {
  const byId = new Map(entries.map(entry => [entry.id, entry]))
  const byOrder = (a: Project, b: Project) => (a.order ?? 0) - (b.order ?? 0)

  // Children per folder id; `null` is the root. A parent that is missing or
  // not a folder counts as the root, as before.
  const children = new Map<string | null, Project[]>()
  for (const entry of entries) {
    const parent = entry.parent_id ? byId.get(entry.parent_id) : undefined
    const key = parent && isFolder(parent) ? parent.id : null
    const list = children.get(key)
    if (list) list.push(entry)
    else children.set(key, [entry])
  }
  for (const list of children.values()) list.sort(byOrder)

  const groups: ProjectGroup[] = []
  const visited = new Set<string>()
  const visit = (folder: Project, title: string) => {
    if (visited.has(folder.id)) return
    visited.add(folder.id)
    const kids = children.get(folder.id) ?? []
    const projects = kids.filter(kid => !isFolder(kid))
    if (projects.length > 0) groups.push({ id: folder.id, title, projects })
    for (const sub of kids.filter(isFolder)) {
      visit(sub, `${title} / ${sub.name}`)
    }
  }

  const rootEntries = children.get(null) ?? []
  for (const folder of rootEntries.filter(isFolder)) {
    visit(folder, folder.name)
  }

  // Folders no root reaches (a cycle in hand-edited data) still list their
  // projects, under the folder's own name.
  for (const [folderId, kids] of children) {
    if (folderId === null || visited.has(folderId)) continue
    const projects = kids.filter(kid => !isFolder(kid))
    const folder = byId.get(folderId)
    if (projects.length > 0 && folder) {
      groups.push({ id: folderId, title: folder.name, projects })
    }
  }

  const rootProjects = rootEntries.filter(entry => !isFolder(entry))
  if (rootProjects.length > 0) {
    groups.push({ id: 'root', title: null, projects: rootProjects })
  }
  return groups
}

/**
 * Open a project as the phone layout's modal.
 *
 * Asks the canvas for its own home page, not the last session: tapping a
 * project on the Home tab must show the project, the same as a sidebar project
 * row did.
 */
export function openProjectFromTab(projectId: string): void {
  navigateToProject(projectId)
  useUIStore.getState().requestProjectHome(projectId)
}

/**
 * Whether a session open is queued right now.
 *
 * `navigateToSession` selects the project and queues the session in the same
 * tick, so when the project layer mounts with an open queued, it was reached by
 * opening a *session* — from Starred, History, the unread bell or the command
 * palette — and it pushes. Otherwise a project was opened, and it rises as a
 * modal.
 */
export function hasQueuedSessionOpen(): boolean {
  return useUIStore.getState().autoOpenSessionWorktreeIds.size > 0
}
