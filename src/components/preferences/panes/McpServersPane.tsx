import React, { useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { usePreferences, useSavePreferences } from '@/services/preferences'
import {
  useMcpServers,
  invalidateMcpServers,
  getNewServersToAutoEnable,
} from '@/services/mcp'
import { useChatStore } from '@/store/chat-store'

const SettingsSection: React.FC<{
  title: string
  children: React.ReactNode
}> = ({ title, children }) => (
  <div className="space-y-4">
    <div>
      <h3 className="text-lg font-medium text-foreground">{title}</h3>
      <Separator className="mt-2" />
    </div>
    {children}
  </div>
)

export const McpServersPane: React.FC = () => {
  const { data: preferences } = usePreferences()
  const savePreferences = useSavePreferences()

  // Get worktree path for project-scope .mcp.json discovery
  const activeWorktreePath = useChatStore(state => state.activeWorktreePath)
  const { data: mcpServers, isLoading } = useMcpServers(activeWorktreePath)

  // Re-read MCP config from disk every time this pane is opened
  useEffect(() => {
    invalidateMcpServers()
  }, [])

  const enabledServers = preferences?.default_enabled_mcp_servers ?? []

  // Auto-enable newly discovered (non-disabled) servers
  useEffect(() => {
    if (!preferences || !mcpServers) return
    const newServers = getNewServersToAutoEnable(mcpServers, enabledServers)
    if (newServers.length > 0) {
      savePreferences.mutate({
        ...preferences,
        default_enabled_mcp_servers: [...enabledServers, ...newServers],
      })
    }
  }, [mcpServers]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggle = (serverName: string) => {
    if (!preferences) return
    const updated = enabledServers.includes(serverName)
      ? enabledServers.filter(n => n !== serverName)
      : [...enabledServers, serverName]
    savePreferences.mutate({
      ...preferences,
      default_enabled_mcp_servers: updated,
    })
  }

  return (
    <div className="space-y-6">
      <SettingsSection title="Default MCP Servers">
        <p className="text-sm text-muted-foreground">
          Selected servers will be enabled by default in new sessions. You can
          override per-session from the toolbar.
        </p>

        {isLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading MCP servers...
          </div>
        ) : !mcpServers || mcpServers.length === 0 ? (
          <div className="py-4 text-sm text-muted-foreground">
            No MCP servers found. Configure servers in{' '}
            <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
              ~/.claude.json
            </code>{' '}
            or{' '}
            <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
              .mcp.json
            </code>{' '}
            in your project root.
          </div>
        ) : (
          <div className="space-y-3">
            {mcpServers.map(server => (
              <div
                key={server.name}
                className={cn(
                  'flex items-center gap-3 rounded-md border px-4 py-3',
                  server.disabled && 'opacity-50'
                )}
              >
                <Checkbox
                  id={`mcp-${server.name}`}
                  checked={
                    !server.disabled && enabledServers.includes(server.name)
                  }
                  onCheckedChange={() => handleToggle(server.name)}
                  disabled={server.disabled}
                />
                <Label
                  htmlFor={`mcp-${server.name}`}
                  className={cn(
                    'flex-1 text-sm font-medium',
                    server.disabled ? 'cursor-default' : 'cursor-pointer'
                  )}
                >
                  {server.name}
                </Label>
                <span className="text-xs text-muted-foreground">
                  {server.disabled ? 'disabled' : server.scope}
                </span>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>
    </div>
  )
}
