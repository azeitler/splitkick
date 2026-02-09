import { useQuery } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '@/services/projects'
import type { McpServerInfo } from '@/types/chat'

/**
 * Fetch available MCP servers from all configuration sources.
 * Reads user-scope (~/.claude.json), local-scope (per-project in ~/.claude.json),
 * and project-scope (.mcp.json) servers.
 */
export function useMcpServers(worktreePath: string | null | undefined) {
  return useQuery({
    queryKey: ['mcp-servers', worktreePath ?? ''],
    queryFn: async () => {
      if (!isTauri()) return []
      return invoke<McpServerInfo[]>('get_mcp_servers', {
        worktreePath: worktreePath ?? null,
      })
    },
    enabled: !!worktreePath,
    staleTime: 1000 * 60 * 5, // 5 min cache
  })
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
