import { useQuery } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '@/services/projects'
import { queryClient } from '@/lib/query-client'
import type { McpServerInfo, McpHealthResult } from '@/types/chat'

/** Query key prefix for MCP server queries */
export const MCP_SERVERS_KEY = 'mcp-servers'

/**
 * Invalidate MCP server queries so they are re-fetched from disk.
 * If worktreePath is provided, only that specific query is invalidated.
 * Otherwise all mcp-servers queries are invalidated.
 */
export function invalidateMcpServers(worktreePath?: string | null) {
  if (worktreePath) {
    queryClient.invalidateQueries({ queryKey: [MCP_SERVERS_KEY, worktreePath] })
  } else {
    queryClient.invalidateQueries({ queryKey: [MCP_SERVERS_KEY] })
  }
}

/**
 * Fetch available MCP servers from all configuration sources.
 * Reads user-scope (~/.claude.json), local-scope (per-project in ~/.claude.json),
 * and project-scope (.mcp.json) servers.
 */
export function useMcpServers(worktreePath: string | null | undefined) {
  return useQuery({
    queryKey: [MCP_SERVERS_KEY, worktreePath ?? ''],
    queryFn: async () => {
      if (!isTauri()) return []
      return invoke<McpServerInfo[]>('get_mcp_servers', {
        worktreePath: worktreePath ?? null,
      })
    },
    enabled: isTauri(),
    staleTime: 1000 * 60 * 5, // 5 min cache
  })
}

/** Query key for MCP health check */
export const MCP_HEALTH_KEY = 'mcp-health'

/**
 * Check health status of all MCP servers via `claude mcp list`.
 * Manual trigger only (enabled: false) — call refetch() to run.
 * Results are cached for 30s to avoid redundant health checks.
 */
export function useMcpHealthCheck() {
  return useQuery({
    queryKey: [MCP_HEALTH_KEY],
    queryFn: async () => {
      if (!isTauri()) return { statuses: {} } as McpHealthResult
      return invoke<McpHealthResult>('check_mcp_health')
    },
    enabled: false,
    staleTime: 30_000,
    retry: 1,
  })
}

/**
 * Find newly discovered MCP servers that should be auto-enabled.
 * Returns server names that are: (1) not disabled in config,
 * (2) not already in the current enabled list, and
 * (3) not in the known servers list (i.e., truly new, not user-disabled).
 *
 * This allows newly added MCP servers to be automatically activated
 * without requiring the user to manually enable each one, while
 * respecting servers the user has explicitly disabled.
 */
export function getNewServersToAutoEnable(
  allServers: McpServerInfo[],
  currentEnabled: string[],
  knownServers: string[]
): string[] {
  const enabledSet = new Set(currentEnabled)
  const knownSet = new Set(knownServers)
  return allServers
    .filter(s => !s.disabled && !enabledSet.has(s.name) && !knownSet.has(s.name))
    .map(s => s.name)
}

/**
 * Build the --mcp-config JSON string from enabled server names.
 * Returns undefined if no servers are enabled.
 */
export function buildMcpConfigJson(
  allServers: McpServerInfo[],
  enabledNames: string[]
): string | undefined {
  if (enabledNames.length === 0) return undefined

  const mcpServers: Record<string, unknown> = {}
  for (const name of enabledNames) {
    const server = allServers.find(s => s.name === name)
    if (server) mcpServers[name] = server.config
  }

  if (Object.keys(mcpServers).length === 0) return undefined
  return JSON.stringify({ mcpServers })
}
