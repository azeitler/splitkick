import { useEffect, useMemo } from 'react'
import { useChatStore } from '@/store/chat-store'
import {
  useMcpServers,
  invalidateMcpServers,
  getNewServersToAutoEnable,
} from '@/services/mcp'
import type { Project } from '@/types/projects'
import type { AppPreferences } from '@/types/preferences'

interface UseMcpServerResolutionParams {
  activeWorktreePath: string | null | undefined
  deferredSessionId: string | undefined
  project: Project | undefined | null
  preferences: AppPreferences | undefined
}

/**
 * Resolves the enabled MCP servers for a session by cascading:
 * session override → project setting → global default, then auto-enabling
 * any newly discovered servers.
 */
export function useMcpServerResolution({
  activeWorktreePath,
  deferredSessionId,
  project,
  preferences,
}: UseMcpServerResolutionParams) {
  const { data: mcpServersData } = useMcpServers(activeWorktreePath)
  const availableMcpServers = useMemo(
    () => mcpServersData ?? [],
    [mcpServersData]
  )

  // Re-read MCP config when switching worktrees
  useEffect(() => {
    if (activeWorktreePath) invalidateMcpServers(activeWorktreePath)
  }, [activeWorktreePath])

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
