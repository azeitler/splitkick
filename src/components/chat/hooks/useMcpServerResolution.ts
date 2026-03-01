import { useEffect, useMemo } from 'react'
import { useChatStore } from '@/store/chat-store'
import {
  useMcpServers,
  invalidateMcpServers,
  getNewServersToAutoEnable,
} from '@/services/mcp'
import type { Project } from '@/types/projects'
import type { AppPreferences, CliBackend } from '@/types/preferences'

interface UseMcpServerResolutionParams {
  activeWorktreePath: string | null | undefined
  deferredSessionId: string | undefined
  project: Project | undefined | null
  preferences: AppPreferences | undefined
  installedBackends: CliBackend[]
}

/**
 * Resolves the enabled MCP servers for a session by cascading:
 * session override → project setting → global default, then auto-enabling
 * any newly discovered servers.
 *
 * Uses only the first installed backend (typically 'claude') for MCP server discovery.
 */
export function useMcpServerResolution({
  activeWorktreePath,
  deferredSessionId,
  project,
  preferences,
  installedBackends,
}: UseMcpServerResolutionParams) {
  const selectedBackend = installedBackends[0] ?? 'claude'
  const { data: mcpServersData } = useMcpServers(activeWorktreePath, selectedBackend)
  const availableMcpServers = useMemo(
    () => mcpServersData ?? [],
    [mcpServersData]
  )

  // Re-read MCP config when switching worktrees or backends
  useEffect(() => {
    if (activeWorktreePath) invalidateMcpServers(activeWorktreePath, selectedBackend)
  }, [activeWorktreePath, selectedBackend])

  const sessionEnabledMcpServers = useChatStore(state =>
    deferredSessionId ? state.enabledMcpServers[deferredSessionId] : undefined
  )

  // Resolve enabled servers from session → project → global defaults
  const baseEnabledMcpServers = useMemo(() => {
    if (sessionEnabledMcpServers !== undefined) return sessionEnabledMcpServers
    if (project?.enabled_mcp_servers != null) return project.enabled_mcp_servers
    return preferences?.default_enabled_mcp_servers ?? []
  }, [
    sessionEnabledMcpServers,
    project?.enabled_mcp_servers,
    preferences?.default_enabled_mcp_servers,
  ])

  const knownMcpServers = useMemo(
    () => project?.known_mcp_servers ?? preferences?.known_mcp_servers ?? [],
    [project?.known_mcp_servers, preferences?.known_mcp_servers]
  )

  const newAutoEnabled = useMemo(
    () =>
      getNewServersToAutoEnable(
        availableMcpServers,
        baseEnabledMcpServers,
        knownMcpServers
      ),
    [availableMcpServers, baseEnabledMcpServers, knownMcpServers]
  )

  const enabledMcpServers = useMemo(
    () =>
      newAutoEnabled.length > 0
        ? [...baseEnabledMcpServers, ...newAutoEnabled]
        : baseEnabledMcpServers,
    [baseEnabledMcpServers, newAutoEnabled]
  )

  return {
    availableMcpServers,
    enabledMcpServers,
    mcpServersData,
  }
}
