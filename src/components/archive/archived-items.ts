import type { ArchivedSessionEntry, Backend } from '@/types/chat'
import type { Project, Worktree } from '@/types/projects'
import { toMilliseconds } from '@/lib/relative-time'

import type { ArchivedSort } from '@/types/ui-state'

export { isArchivedSort, type ArchivedSort } from '@/types/ui-state'

export type ArchivedKindFilter = 'all' | 'session' | 'worktree'

/** Why an item was archived, when the app archived it on its own. */
export type ArchiveReason = 'pr_merged' | 'folder_missing' | 'base_closed'

export const ARCHIVE_REASON_LABELS: Record<ArchiveReason, string> = {
  pr_merged: 'PR merged',
  folder_missing: 'Folder missing',
  base_closed: 'Closed with base session',
}

interface ArchivedItemBase {
  /** Unique across both kinds, e.g. `session:<id>` */
  key: string
  id: string
  name: string
  /** Unix seconds; 0 when unknown (sorts last) */
  archivedAt: number
  projectId: string
  projectName: string
  reason?: ArchiveReason
}

export interface ArchivedWorktreeItem extends ArchivedItemBase {
  kind: 'worktree'
  branch: string
  worktree: Worktree
}

export interface ArchivedSessionItem extends ArchivedItemBase {
  kind: 'session'
  worktreeName: string
  backend?: Backend
  messageCount: number
  preview?: string
  entry: ArchivedSessionEntry
}

export type ArchivedItem = ArchivedWorktreeItem | ArchivedSessionItem

export function worktreeArchiveReason(
  worktree: Worktree
): ArchiveReason | undefined {
  if (worktree.auto_archived) return 'folder_missing'
  if (worktree.auto_archived_pr_url) return 'pr_merged'
  return undefined
}

/** Normalize both archive lists into one list of rows. */
export function toArchivedItems(
  worktrees: Worktree[] | undefined,
  sessions: ArchivedSessionEntry[] | undefined,
  projects: Project[] | undefined
): ArchivedItem[] {
  const projectNames = new Map((projects ?? []).map(p => [p.id, p.name]))
  const items: ArchivedItem[] = []
  for (const worktree of worktrees ?? []) {
    items.push({
      kind: 'worktree',
      key: `worktree:${worktree.id}`,
      id: worktree.id,
      name: worktree.name,
      archivedAt: worktree.archived_at ?? 0,
      projectId: worktree.project_id,
      projectName: projectNames.get(worktree.project_id) ?? '',
      branch: worktree.branch,
      reason: worktreeArchiveReason(worktree),
      worktree,
    })
  }
  for (const entry of sessions ?? []) {
    const { session } = entry
    items.push({
      kind: 'session',
      key: `session:${session.id}`,
      id: session.id,
      name: session.name,
      archivedAt: session.archived_at ?? 0,
      projectId: entry.project_id,
      projectName: entry.project_name,
      worktreeName: entry.worktree_name,
      backend: session.backend,
      messageCount: session.message_count ?? session.messages.length,
      preview: entry.last_message_preview || undefined,
      reason: session.archived_by_base_close ? 'base_closed' : undefined,
      entry,
    })
  }
  return items
}

export interface ArchivedFilters {
  query: string
  kind: ArchivedKindFilter
  /** Empty string = all projects */
  projectId: string
  /** Empty string = all backends. Worktrees have no backend and drop out. */
  backend: string
}

export const DEFAULT_ARCHIVED_FILTERS: ArchivedFilters = {
  query: '',
  kind: 'all',
  projectId: '',
  backend: '',
}

function searchText(item: ArchivedItem): string {
  const parts =
    item.kind === 'worktree'
      ? [item.name, item.branch, item.projectName]
      : [item.name, item.worktreeName, item.projectName, item.preview ?? '']
  return parts.join('\n').toLowerCase()
}

/**
 * Filter the rows. `messageMatches` holds the session ids whose message text
 * matched the query on the backend (`search_session_messages`); those pass
 * the query check too.
 */
export function filterArchivedItems(
  items: ArchivedItem[],
  filters: ArchivedFilters,
  messageMatches?: ReadonlySet<string>
): ArchivedItem[] {
  const query = filters.query.trim().toLowerCase()
  return items.filter(item => {
    if (filters.kind !== 'all' && item.kind !== filters.kind) return false
    if (filters.projectId && item.projectId !== filters.projectId) return false
    if (
      filters.backend &&
      (item.kind !== 'session' || item.backend !== filters.backend)
    ) {
      return false
    }
    if (!query || searchText(item).includes(query)) return true
    return item.kind === 'session' && !!messageMatches?.has(item.id)
  })
}

const byNewest = (a: ArchivedItem, b: ArchivedItem) =>
  b.archivedAt - a.archivedAt
const byName = (a: ArchivedItem, b: ArchivedItem) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

/** A section of the list with its heading. */
export interface ArchivedGroup {
  key: string
  label: string
  items: ArchivedItem[]
}

export type ArchiveTimeBucket =
  | 'today'
  | 'yesterday'
  | 'week'
  | 'month'
  | 'older'

export const ARCHIVE_TIME_BUCKET_LABELS: Record<ArchiveTimeBucket, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'This week',
  month: 'This month',
  older: 'Older',
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Calendar bucket of an archive time, in local time: Today, Yesterday, the
 * 7 days up to today, the 30 days up to today, then Older.
 */
export function archiveTimeBucket(
  archivedAt: number,
  now = Date.now()
): ArchiveTimeBucket {
  if (!archivedAt) return 'older'
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const today = startOfToday.getTime()
  const time = toMilliseconds(archivedAt)
  if (time >= today) return 'today'
  if (time >= today - DAY_MS) return 'yesterday'
  if (time >= today - 6 * DAY_MS) return 'week'
  if (time >= today - 29 * DAY_MS) return 'month'
  return 'older'
}

/**
 * Sort and section the rows.
 * - `archived`: newest first, in time buckets (Today, Yesterday, …).
 * - `name`: A–Z, one unnamed section.
 * - `project`: projects A–Z, newest first inside each project.
 */
export function groupArchivedItems(
  items: ArchivedItem[],
  sort: ArchivedSort,
  now = Date.now()
): ArchivedGroup[] {
  if (sort === 'name') {
    return items.length
      ? [{ key: 'all', label: '', items: [...items].sort(byName) }]
      : []
  }

  const groups = new Map<string, ArchivedGroup>()
  const add = (key: string, label: string, item: ArchivedItem) => {
    const group = groups.get(key)
    if (group) group.items.push(item)
    else groups.set(key, { key, label, items: [item] })
  }

  const sorted = [...items].sort((a, b) => byNewest(a, b) || byName(a, b))
  if (sort === 'archived') {
    for (const item of sorted) {
      const bucket = archiveTimeBucket(item.archivedAt, now)
      add(bucket, ARCHIVE_TIME_BUCKET_LABELS[bucket], item)
    }
    // Buckets come out in order because the items are sorted newest first.
    return [...groups.values()]
  }

  for (const item of sorted) {
    add(item.projectId, item.projectName || 'Unknown project', item)
  }
  return [...groups.values()].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
  )
}

/** Full local date and time, e.g. "Nov 6, 2026, 14:03". */
export function formatArchiveDate(archivedAt: number): string {
  return new Date(toMilliseconds(archivedAt)).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
