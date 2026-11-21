import { useMemo } from 'react'
import { usePreferences } from '@/services/preferences'
import type { RoleProfile, GraphPermission } from '@/types/graphs'

/** Permission levels, lowest first. */
export const GRAPH_PERMISSIONS: readonly GraphPermission[] = [
  'read',
  'write',
  'manage',
]

/** What each level may do (enforced in the MCP tools). */
export const PERMISSION_DESCRIPTIONS: Record<GraphPermission, string> = {
  read: 'Read graphs; set serves on its own session.',
  write:
    'Create and edit nodes, relations, attachments; propose; send requests.',
  manage: 'Also commit, accept done, drop.',
}

/** Swatches of the agent editor. */
export const ROLE_COLORS = [
  '#f97316',
  '#3b82f6',
  '#22c55e',
  '#a855f7',
  '#eab308',
  '#6b7280',
] as const

/** A starting point for a new agent: a profile without an id. */
export type RoleTemplate = Omit<RoleProfile, 'id'> & { summary: string }

/** Templates the Agents pane offers while no agent exists. */
export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  {
    name: 'Vision keeper',
    summary: 'Owns a whole graph: keeps it true, accepts done work.',
    color: ROLE_COLORS[0],
    permission: 'manage',
    backend: null,
    model: null,
    default_serves: null,
    persona: [
      'You are the vision keeper of the graph this session serves.',
      'Keep the graph true to what the product must become: read it often, fix titles, order and dependencies, and drop nodes that no longer belong.',
      'Answer open requests from worker sessions. Accept a node as done only when its result is merged and matches the node.',
      'Give a short why for every change. Do not write code yourself.',
    ].join('\n'),
  },
  {
    name: 'Project manager',
    summary: 'Turns graph nodes into issues and sessions, then follows up.',
    color: ROLE_COLORS[1],
    permission: 'write',
    backend: null,
    model: null,
    default_serves: null,
    persona: [
      'You are the project manager of the graph this session serves.',
      'Find nodes that are ready (their dependencies are done) and turn each into concrete work: an issue, a worktree and a session that serves the node.',
      'Follow up on running sessions, update node states and send a request when a decision is not yours to make.',
      'Report progress in short, factual updates.',
    ].join('\n'),
  },
  {
    name: 'Worker',
    summary: 'Implements the one node it serves, asks when blocked.',
    color: ROLE_COLORS[2],
    permission: 'read',
    backend: null,
    model: null,
    default_serves: null,
    persona: [
      'You implement the node this session serves, and nothing beyond it.',
      'Read the node, what it depends on and what needs it before you start.',
      'When the node is unclear or blocked, say so and stop instead of guessing.',
      'When you finish, summarise what changed and how to test it.',
    ].join('\n'),
  },
  {
    name: 'Reviewer',
    summary: 'Checks finished work against its node before it is accepted.',
    color: ROLE_COLORS[3],
    permission: 'read',
    backend: null,
    model: null,
    default_serves: null,
    persona: [
      'You review work against the node this session serves.',
      'Check that the change does what the node asks, has tests, and breaks nothing next to it.',
      'List findings by severity with file and line. Do not change code unless asked.',
    ].join('\n'),
  },
]

/** A new profile made from `template`. */
export function profileFromTemplate(template: RoleTemplate): RoleProfile {
  const { summary: _summary, ...profile } = template
  return { ...profile, id: crypto.randomUUID() }
}

/** Levels up to and including `max`. */
export function permissionsUpTo(max: GraphPermission): GraphPermission[] {
  return GRAPH_PERMISSIONS.slice(0, GRAPH_PERMISSIONS.indexOf(max) + 1)
}

/** `wanted`, lowered to `max` when it is higher. */
export function capPermission(
  wanted: GraphPermission,
  max: GraphPermission
): GraphPermission {
  return GRAPH_PERMISSIONS.indexOf(wanted) > GRAPH_PERMISSIONS.indexOf(max)
    ? max
    : wanted
}

/** Narrow a stored permission string; unknown values read as null. */
export function asPermission(
  value: string | null | undefined
): GraphPermission | null {
  return value === 'read' || value === 'write' || value === 'manage'
    ? value
    : null
}

/**
 * A session's effective graph permission (contract): its own
 * `graph_permission`, else the agent's level, else `read`.
 */
export function effectivePermission(
  sessionPermission: string | null | undefined,
  agent: RoleProfile | undefined
): GraphPermission {
  return asPermission(sessionPermission) ?? agent?.permission ?? 'read'
}

const NO_PROFILES: RoleProfile[] = []

/** Saved agent profiles (`AppPreferences.role_profiles`). */
export function useRoleProfiles(): RoleProfile[] {
  const { data } = usePreferences()
  return data?.role_profiles ?? NO_PROFILES
}

/** One saved profile by id, or undefined. */
export function useRoleProfile(
  roleId: string | null | undefined
): RoleProfile | undefined {
  const profiles = useRoleProfiles()
  return useMemo(
    () => (roleId ? profiles.find(p => p.id === roleId) : undefined),
    [profiles, roleId]
  )
}
