import { toMilliseconds } from '@/lib/relative-time'
import type { AllSessionsEntry, LabelData, Session } from '@/types/chat'

export interface SessionCommand {
  /** Palette command id — `goto-session-<sessionId>` */
  id: string
  session: Session
  projectId: string
  projectName: string
  worktreeId: string
  worktreeName: string
  worktreePath: string
  /** Primary row text */
  label: string
  /** Secondary row text — `project · worktree` */
  description: string
  /** Value handed to cmdk, which re-ranks whatever this builder returns */
  searchValue: string
  /** Lowercased haystack this builder matches against (no session id) */
  matchText: string
}

export const RECENT_SESSION_LIMIT = 5
export const SEARCHED_SESSION_LIMIT = 8

export interface BuildSessionCommandsOptions {
  entries: AllSessionsEntry[]
  /** Live label overrides from the chat store, which win over the persisted one */
  sessionLabels?: Record<string, LabelData | undefined>
  query: string
  /** The session already on screen — excluded so the top hit is somewhere new */
  excludeSessionId?: string | null
  recentLimit?: number
  searchLimit?: number
}

/** Newest-activity timestamp, normalized so seconds and ms can be compared. */
function sessionActivity(session: Session): number {
  const raw =
    session.last_message_at ?? session.updated_at ?? session.created_at
  return raw ? toMilliseconds(raw) : 0
}

function resolveLabelName(
  session: Session,
  sessionLabels: Record<string, LabelData | undefined>
): string {
  return sessionLabels[session.id]?.name ?? session.label?.name ?? ''
}

function toSessionCommand(
  entry: AllSessionsEntry,
  session: Session,
  sessionLabels: Record<string, LabelData | undefined>
): SessionCommand {
  const labelName = resolveLabelName(session, sessionLabels)
  const matchText =
    `${session.name} ${entry.project_name} ${entry.worktree_name} ${labelName}`.toLowerCase()

  return {
    id: `goto-session-${session.id}`,
    session,
    projectId: entry.project_id,
    projectName: entry.project_name,
    worktreeId: entry.worktree_id,
    worktreeName: entry.worktree_name,
    worktreePath: entry.worktree_path,
    label: session.name,
    description: `${entry.project_name} · ${entry.worktree_name}`,
    // The session id keeps cmdk values unique for identically named sessions.
    // It stays out of matchText so a query can never match a raw uuid.
    searchValue: `${matchText} ${session.id}`,
    matchText,
  }
}

/**
 * Rank tier for a query hit: name prefix beats name substring, which beats a
 * match that only came from the project, worktree, or label.
 */
function matchTier(command: SessionCommand, query: string): number {
  const name = command.label.toLowerCase()
  if (name.startsWith(query)) return 0
  if (name.includes(query)) return 1
  return 2
}

/**
 * Build the palette's session entries.
 *
 * With an empty query this returns the most recently active sessions, so the
 * palette is useful before the user types anything.
 */
export function buildSessionCommands({
  entries,
  sessionLabels = {},
  query,
  excludeSessionId = null,
  recentLimit = RECENT_SESSION_LIMIT,
  searchLimit = SEARCHED_SESSION_LIMIT,
}: BuildSessionCommandsOptions): SessionCommand[] {
  const candidates: SessionCommand[] = []

  for (const entry of entries) {
    for (const session of entry.sessions) {
      if (session.archived_at) continue
      if (excludeSessionId && session.id === excludeSessionId) continue
      candidates.push(toSessionCommand(entry, session, sessionLabels))
    }
  }

  const byRecency = (a: SessionCommand, b: SessionCommand) =>
    sessionActivity(b.session) - sessionActivity(a.session)

  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return candidates.sort(byRecency).slice(0, recentLimit)
  }

  return candidates
    .filter(command => command.matchText.includes(normalizedQuery))
    .sort(
      (a, b) =>
        matchTier(a, normalizedQuery) - matchTier(b, normalizedQuery) ||
        byRecency(a, b)
    )
    .slice(0, searchLimit)
}
