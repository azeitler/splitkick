import { useMemo } from 'react'
import { usePreferences } from '@/services/preferences'
import type { AgentProfile, GraphPermission } from '@/types/graphs'

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
export const AGENT_COLORS = [
  '#f97316',
  '#3b82f6',
  '#22c55e',
  '#a855f7',
  '#eab308',
  '#6b7280',
] as const

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
  agent: AgentProfile | undefined
): GraphPermission {
  return asPermission(sessionPermission) ?? agent?.permission ?? 'read'
}

const NO_PROFILES: AgentProfile[] = []

/** Saved agent profiles (`AppPreferences.agent_profiles`). */
export function useAgentProfiles(): AgentProfile[] {
  const { data } = usePreferences()
  return data?.agent_profiles ?? NO_PROFILES
}

/** One saved profile by id, or undefined. */
export function useAgentProfile(
  agentId: string | null | undefined
): AgentProfile | undefined {
  const profiles = useAgentProfiles()
  return useMemo(
    () => (agentId ? profiles.find(p => p.id === agentId) : undefined),
    [profiles, agentId]
  )
}
