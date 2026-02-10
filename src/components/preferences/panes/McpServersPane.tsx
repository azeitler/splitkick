import React, { useEffect } from 'react'
import { CheckCircle, Loader2, ShieldAlert, XCircle } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Checkbox } from '@/components/ui/checkbox'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { usePreferences, useSavePreferences } from '@/services/preferences'
import {
  useMcpServers,
  invalidateMcpServers,
  getNewServersToAutoEnable,
  useMcpHealthCheck,
} from '@/services/mcp'
import { useChatStore } from '@/store/chat-store'
import type { McpHealthStatus } from '@/types/chat'

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

function HealthIndicator({
  status,
  isChecking,
}: {
  status: McpHealthStatus | undefined
  isChecking: boolean
}) {
  if (isChecking) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        checking...
      </span>
    )
  }

  if (!status) return null

  switch (status) {
    case 'connected':
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
              <CheckCircle className="size-3.5" />
              connected
            </span>
          </TooltipTrigger>
          <TooltipContent>Server is connected and ready</TooltipContent>
        </Tooltip>
      )
    case 'needsAuthentication':
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
              <ShieldAlert className="size-3.5" />
              needs auth
            </span>
          </TooltipTrigger>
          <TooltipContent>{"Run 'claude /mcp' in your terminal to authenticate"}</TooltipContent>
        </Tooltip>
      )
    case 'couldNotConnect':
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
              <XCircle className="size-3.5" />
              connection failed
            </span>
          </TooltipTrigger>
          <TooltipContent>Could not connect -- check that the server is running</TooltipContent>
        </Tooltip>
      )
    case 'disabled':
      return null // Already shown via opacity + "disabled" label
    default:
      return null
  }
}

export const McpServersPane: React.FC = () => {
  const { data: preferences } = usePreferences()
  const savePreferences = useSavePreferences()

  // Get worktree path for project-scope .mcp.json discovery
  const activeWorktreePath = useChatStore(state => state.activeWorktreePath)
  const { data: mcpServers, isLoading } = useMcpServers(activeWorktreePath)

  // Health check — triggered on mount
  const {
    data: healthResult,
    isFetching: isHealthChecking,
    refetch: checkHealth,
  } = useMcpHealthCheck()

  // Re-read MCP config from disk and trigger health check every time this pane is opened
  useEffect(() => {
    invalidateMcpServers()
    checkHealth()
  }, [checkHealth])

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
                <HealthIndicator
                  status={healthResult?.statuses[server.name]}
                  isChecking={isHealthChecking}
                />
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
