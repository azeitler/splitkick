import Fuse from 'fuse.js'
import type { Agent } from '@/types/agents'
import type { AllSessionsEntry } from '@/types/chat'
import { isFolder, isVisibleProject, type Project } from '@/types/projects'
import {
  splitkickMarkdownLink,
  type SplitkickLinkKind,
} from '@/lib/splitkick-links'

/**
 * Objects the `@` picker can mention next to files: sessions, projects,
 * worktrees, agents and remote connections. A mention inserts a markdown link
 * with the object's name and its `splitkick://` link, which the model resolves
 * with the Splitkick MCP tools (see `docs/developer/splitkick-links.md`).
 */
export type MentionObjectKind = SplitkickLinkKind

export interface MentionObject {
  kind: MentionObjectKind
  id: string
  name: string
  /** Short second line: where it lives, its path, scope or host. */
  detail: string
  /** In the current project (or a connection): the likely target. */
  likely: boolean
  /** Unix seconds of the last activity, 0 when unknown. Ties break on it. */
  recency: number
}

/** A connection as `list_remote_connections` returns it (never a token). */
export interface MentionConnection {
  id: string
  name: string
  url: string
}

export interface MentionSources {
  entries: AllSessionsEntry[]
  projects: Project[]
  agents: Agent[]
  connections: MentionConnection[]
  currentProjectId: string | null
  currentSessionId: string | null
}

/** Group order when nothing was typed (and for ties). */
export const MENTION_GROUP_ORDER = [
  'file',
  'session',
  'project',
  'worktree',
  'agent',
  'connection',
] as const
export type MentionGroupId = (typeof MENTION_GROUP_ORDER)[number]

export const MENTION_GROUP_HEADINGS: Record<MentionGroupId, string> = {
  file: 'Files',
  session: 'Sessions',
  project: 'Projects',
  worktree: 'Worktrees',
  agent: 'Agents',
  connection: 'Connections',
}

/** Rows per object group: fewer while browsing, more once a query narrows. */
const BROWSE_LIMIT = 5
const SEARCH_LIMIT = 8
/** How much a likely target (current project) outranks a better text match. */
const LIKELY_BONUS = 0.1

function hostOf(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

/** Build every mentionable object. Cheap: plain maps over cached lists. */
export function buildMentionObjects({
  entries,
  projects,
  agents,
  connections,
  currentProjectId,
  currentSessionId,
}: MentionSources): Record<Exclude<MentionGroupId, 'file'>, MentionObject[]> {
  const sessions: MentionObject[] = []
  const worktrees: MentionObject[] = []
  const lastActivityByProject = new Map<string, number>()

  for (const entry of entries) {
    const likely = entry.project_id === currentProjectId
    let worktreeRecency = 0
    for (const session of entry.sessions) {
      worktreeRecency = Math.max(worktreeRecency, session.updated_at ?? 0)
      if (session.archived_at || session.id === currentSessionId) continue
      sessions.push({
        kind: 'session',
        id: session.id,
        name: session.name,
        detail: `${entry.project_name} › ${entry.worktree_name}`,
        likely,
        recency: session.updated_at ?? 0,
      })
    }
    worktrees.push({
      kind: 'worktree',
      id: entry.worktree_id,
      name: entry.worktree_name,
      detail: entry.worktree_path,
      likely,
      recency: worktreeRecency,
    })
    lastActivityByProject.set(
      entry.project_id,
      Math.max(
        lastActivityByProject.get(entry.project_id) ?? 0,
        worktreeRecency
      )
    )
  }

  const projectObjects = projects
    .filter(project => isVisibleProject(project) && !isFolder(project))
    .map<MentionObject>(project => ({
      kind: 'project',
      id: project.id,
      name: project.name,
      detail: project.path,
      likely: project.id === currentProjectId,
      recency: lastActivityByProject.get(project.id) ?? 0,
    }))

  const agentObjects = agents.map<MentionObject>(agent => ({
    kind: 'agent',
    id: agent.id,
    name: agent.name,
    detail:
      agent.scope === 'global'
        ? 'Global agent'
        : `Project agent · ${agent.projectName ?? 'unknown project'}`,
    // A global agent is reachable from every project.
    likely: agent.scope === 'global' || agent.projectId === currentProjectId,
    recency: agent.createdAt,
  }))

  const connectionObjects = connections.map<MentionObject>(connection => ({
    kind: 'connection',
    id: connection.id,
    name: connection.name,
    detail: hostOf(connection.url),
    likely: true,
    recency: 0,
  }))

  return {
    session: sessions,
    project: projectObjects,
    worktree: worktrees,
    agent: agentObjects,
    connection: connectionObjects,
  }
}

export interface ScoredMention {
  item: MentionObject
  /** Fuse score, lower is better; likely targets get a bonus. */
  score: number
}

function byRank(a: ScoredMention, b: ScoredMention): number {
  return a.score - b.score || b.item.recency - a.item.recency
}

/**
 * Search one group. Without a query: likely targets first, then the most
 * recent. With a query: best fuzzy match, where a likely target wins over a
 * slightly better match elsewhere.
 */
export function searchMentionGroup(
  items: MentionObject[],
  query: string,
  fuse?: Fuse<MentionObject>
): ScoredMention[] {
  const trimmed = query.trim()
  if (!trimmed) {
    return items
      .map(item => ({ item, score: item.likely ? 0 : LIKELY_BONUS }))
      .sort(byRank)
      .slice(0, BROWSE_LIMIT)
  }
  const index = fuse ?? createMentionFuse(items)
  return index
    .search(trimmed)
    .map(result => ({
      item: result.item,
      score: (result.score ?? 0) - (result.item.likely ? LIKELY_BONUS : 0),
    }))
    .sort(byRank)
    .slice(0, SEARCH_LIMIT)
}

export function createMentionFuse(items: MentionObject[]): Fuse<MentionObject> {
  return new Fuse(items, {
    keys: [
      { name: 'name', weight: 2 },
      { name: 'detail', weight: 1 },
    ],
    threshold: 0.4,
    ignoreLocation: true,
    includeScore: true,
  })
}

/** A query with a slash or a dot is most likely a file path. */
export function looksLikePath(query: string): boolean {
  return /[/\\.]/.test(query)
}

/**
 * Order the groups: Files first while browsing or for a path-like query.
 * Otherwise the group with the best match comes first, so `@release` puts a
 * session named "Release" above a file that matches a few letters.
 */
export function orderMentionGroups(
  query: string,
  bestScores: Partial<Record<MentionGroupId, number>>
): MentionGroupId[] {
  const present = MENTION_GROUP_ORDER.filter(id => bestScores[id] !== undefined)
  if (!query.trim() || looksLikePath(query)) return present
  return [...present].sort(
    (a, b) =>
      (bestScores[a] ?? 1) - (bestScores[b] ?? 1) ||
      MENTION_GROUP_ORDER.indexOf(a) - MENTION_GROUP_ORDER.indexOf(b)
  )
}

/** What a mention inserts: `[name](splitkick://kind/id)`. */
export function mentionMarkdown(item: MentionObject): string {
  return splitkickMarkdownLink(item.kind, item.id, item.name)
}
