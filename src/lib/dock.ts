/**
 * Data for the macOS dock icon: the unread badge and the right-click menu.
 * Rust side: `src-tauri/src/dock.rs`.
 */

import {
  getSessionStatus,
  isUnreadSession,
} from '@/components/unread/unread-utils'
import type { AllSessionsResponse, Session } from '@/types/chat'

export const DOCK_MENU_LIMIT = 8

/** Matches `DockSession` in `dock.rs`. */
export interface DockSession {
  title: string
  projectId: string
  worktreeId: string
  sessionId: string
}

export function countUnreadSessions(
  allSessions: AllSessionsResponse | undefined
): number {
  let count = 0
  for (const entry of allSessions?.entries ?? []) {
    for (const session of entry.sessions) {
      if (isUnreadSession(session)) count++
    }
  }
  return count
}

/**
 * Dock menu entries: unread sessions first (newest activity first), then the
 * sessions opened most recently.
 */
export function buildDockSessions(
  allSessions: AllSessionsResponse | undefined,
  limit = DOCK_MENU_LIMIT
): DockSession[] {
  const unread: { session: Session; entry: DockEntry }[] = []
  const recent: { session: Session; entry: DockEntry }[] = []
  for (const entry of allSessions?.entries ?? []) {
    for (const session of entry.sessions) {
      if (session.archived_at) continue
      if (isUnreadSession(session)) unread.push({ session, entry })
      else if (session.last_opened_at) recent.push({ session, entry })
    }
  }
  unread.sort((a, b) => b.session.updated_at - a.session.updated_at)
  recent.sort(
    (a, b) => (b.session.last_opened_at ?? 0) - (a.session.last_opened_at ?? 0)
  )
  return [...unread, ...recent].slice(0, limit).map(({ session, entry }) => {
    const status = isUnreadSession(session)
      ? getSessionStatus(session)?.label
      : undefined
    const title = `${session.name} — ${entry.project_name}`
    return {
      title: status ? `${title} · ${status}` : title,
      projectId: entry.project_id,
      worktreeId: entry.worktree_id,
      sessionId: session.id,
    }
  })
}

type DockEntry = AllSessionsResponse['entries'][number]
