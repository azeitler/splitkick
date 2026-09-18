import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle,
  Copy,
  Loader2,
  PlugZap,
  XCircle,
} from '@/components/icons/reicon'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { copyToClipboard } from '@/lib/clipboard'
import { cn } from '@/lib/utils'
import { invoke, listen } from '@/lib/transport'
import { useInstalledBackends } from '@/hooks/useInstalledBackends'
import { invalidateAllMcpServers } from '@/services/mcp'
import { usePatchPreferences, usePreferences } from '@/services/preferences'
import type { McpServerInfo } from '@/types/chat'
import type { CliBackend } from '@/types/preferences'
import { SettingsSection } from '../SettingsSection'

interface JeanMcpSnippet {
  enabled: boolean
  serverRunning: boolean
  mode: 'dev' | 'prod'
  serverName: string
  url: string | null
  token: string | null
  claude: string | null
  cursor: string | null
  codexToml: string | null
  grokToml: string | null
  kimi: string | null
  opencodeJson: string | null
}

interface JeanMcpInstallResult {
  backend: CliBackend
  status: 'installed' | 'error'
  path: string | null
  backupPath: string | null
  serverName: string
  mode: 'dev' | 'prod'
  message: string
}

type InstallState = 'idle' | 'installing' | 'success' | 'error'

/** Backends that support persistent Jean MCP config install. */
const INSTALLABLE_BACKENDS = [
  'claude',
  'codex',
  'opencode',
  'cursor',
  'grok',
  'kimi',
  'antigravity',
] as const satisfies readonly CliBackend[]

const BACKEND_LABELS: Record<(typeof INSTALLABLE_BACKENDS)[number], string> = {
  claude: 'Claude',
  codex: 'Codex',
  opencode: 'OpenCode',
  cursor: 'Cursor',
  grok: 'Grok',
  kimi: 'Kimi',
  antigravity: 'Antigravity',
}

interface SnippetTarget {
  id: string
  label: string
  path: string
  content: string | null
}

function installButtonContent(state: InstallState, message: string) {
  switch (state) {
    case 'installing':
      return (
        <>
          <Loader2 className="size-3.5 animate-spin" />
          <span>Adding...</span>
        </>
      )
    case 'success':
      return (
        <>
          <CheckCircle className="size-3.5" />
          <span className="truncate">{message || 'Added'}</span>
        </>
      )
    case 'error':
      return (
        <>
          <XCircle className="size-3.5" />
          <span className="truncate">{message}</span>
        </>
      )
    default:
      return null
  }
}

function handleCopySnippet(label: string, content: string | null) {
  if (!content) {
    toast.error(`No ${label} snippet available — enable Jean MCP first`)
    return
  }
  copyToClipboard(content)
  toast.success(`${label} snippet copied`)
}

interface JeanMcpSectionProps {
  mcpServers: McpServerInfo[]
}

export const JeanMcpSection: React.FC<JeanMcpSectionProps> = ({
  mcpServers,
}) => {
  const { data: preferences } = usePreferences()
  const patchPreferences = usePatchPreferences()
  const { installedBackends } = useInstalledBackends()
  const queryClient = useQueryClient()
  const [installState, setInstallState] = useState<InstallState>('idle')
  const [installMessage, setInstallMessage] = useState('')
  const enabled = true
  const {
    data: snippet,
    refetch: refreshSnippet,
    isLoading: isSnippetLoading,
    isFetching: isSnippetFetching,
  } = useQuery<JeanMcpSnippet>({
    queryKey: ['jeanMcpSnippet'],
    queryFn: () => invoke<JeanMcpSnippet>('get_jean_mcp_config_snippet'),
  })

  const serverRunning = snippet?.serverRunning ?? false
  const checkingServer = !snippet && (isSnippetLoading || isSnippetFetching)
  const modeLabel = (snippet?.mode ?? 'prod') === 'dev' ? 'Dev' : 'Prod'
  const installableBackends = installedBackends.filter(
    (backend): backend is (typeof INSTALLABLE_BACKENDS)[number] =>
      (INSTALLABLE_BACKENDS as readonly CliBackend[]).includes(backend)
  )
  const configuredBackends = installableBackends.filter(backend =>
    mcpServers.some(
      server =>
        server.backend === backend && server.name === snippet?.serverName
    )
  )
  const installableLabels = installableBackends.flatMap(backend => {
    const label = BACKEND_LABELS[backend]
    return label ? [label] : []
  })

  const snippetTargets = useMemo<SnippetTarget[]>(
    () => [
      {
        id: 'claude',
        label: 'Claude',
        path: '~/.claude.json',
        content: snippet?.claude ?? null,
      },
      {
        id: 'codex',
        label: 'Codex',
        path: '~/.codex/config.toml',
        content: snippet?.codexToml ?? null,
      },
      {
        id: 'cursor',
        label: 'Cursor',
        path: '~/.cursor/mcp.json',
        content: snippet?.cursor ?? null,
      },
      {
        id: 'grok',
        label: 'Grok',
        path: '~/.grok/config.toml',
        content: snippet?.grokToml ?? null,
      },
      {
        id: 'kimi',
        label: 'Kimi',
        path: '~/.kimi-code/mcp.json',
        content: snippet?.kimi ?? null,
      },
      {
        id: 'opencode',
        label: 'OpenCode',
        path: '~/.config/opencode/opencode.json',
        content: snippet?.opencodeJson ?? null,
      },
      {
        id: 'antigravity',
        label: 'Antigravity',
        path: '~/.gemini/config/mcp_config.json',
        content: snippet?.claude ?? null,
      },
    ],
    [snippet]
  )

  const setTemporaryInstallState = useCallback(
    (state: InstallState, message = '') => {
      setInstallState(state)
      setInstallMessage(message)
      if (state === 'success' || state === 'error') {
        window.setTimeout(() => {
          setInstallState('idle')
          setInstallMessage('')
        }, 5000)
      }
    },
    []
  )

  useEffect(() => {
    let unlisten: (() => void) | undefined
    let disposed = false
    listen('jean-mcp-socket-status', () => {
      queryClient.invalidateQueries({ queryKey: ['jeanMcpSnippet'] })
    }).then(fn => {
      if (disposed) fn()
      else unlisten = fn
    })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [queryClient])

  const handleInstall = useCallback(async () => {
    if (!serverRunning) {
      setTemporaryInstallState('error', 'Jean MCP socket is not running')
      return
    }
    if (installableBackends.length === 0) {
      setTemporaryInstallState(
        'error',
        'Install a supported CLI first (Claude, Codex, Cursor, Grok, Kimi, Antigravity, or OpenCode)'
      )
      return
    }

    setTemporaryInstallState('installing')
    try {
      const results = await invoke<JeanMcpInstallResult[]>(
        'install_jean_mcp_config',
        {
          backends: installableBackends,
          mode: 'current',
        }
      )
      const successes = results.filter(r => r.status === 'installed')
      const failures = results.filter(r => r.status === 'error')
      invalidateAllMcpServers(undefined, installableBackends)
      await refreshSnippet()
      setTemporaryInstallState(
        failures.length > 0 ? 'error' : 'success',
        failures.length > 0
          ? `Added ${successes.length}/${results.length}; ${failures.length} failed`
          : 'Added'
      )
    } catch (e) {
      setTemporaryInstallState('error', 'Failed to add Jean MCP')
      console.error('Failed to add Jean MCP config', e)
    }
  }, [
    installableBackends,
    refreshSnippet,
    serverRunning,
    setTemporaryInstallState,
  ])

  const transientButton = installButtonContent(installState, installMessage)

  return (
    <>
      <SettingsSection title="Jean MCP Server" anchorId="pref-mcp-section-jean">
        <p className="text-sm text-muted-foreground">
          Expose Jean&apos;s own commands over MCP so spawned local CLIs can
          call back into Jean (create worktrees, list GitHub issues, send chat
          messages, etc).
        </p>

        <div className="flex flex-col gap-2 rounded-md border px-4 py-3 sm:flex-row sm:items-center sm:gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium">
            <CheckCircle className="size-4 text-green-600 dark:text-green-400" />
            Required and automatically activated
          </div>
          {checkingServer && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 shrink-0 animate-spin" />
              Checking MCP socket…
            </span>
          )}
          {!checkingServer && !serverRunning && (
            <span className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
              <PlugZap className="size-3.5 shrink-0" />
              MCP socket not running
            </span>
          )}
        </div>

        {enabled && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="jean-mcp-max-depth" className="text-xs">
                  Max recursion depth
                </Label>
                <Input
                  id="jean-mcp-max-depth"
                  type="number"
                  min={0}
                  max={10}
                  value={preferences?.jean_mcp_max_depth ?? 3}
                  onChange={e =>
                    patchPreferences.mutate({
                      jean_mcp_max_depth: Math.max(
                        0,
                        Math.min(10, Number(e.target.value) || 0)
                      ),
                    })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="jean-mcp-rate-limit" className="text-xs">
                  Spawn rate limit (per minute)
                </Label>
                <Input
                  id="jean-mcp-rate-limit"
                  type="number"
                  min={0}
                  max={1000}
                  value={preferences?.jean_mcp_rate_limit_per_minute ?? 20}
                  onChange={e =>
                    patchPreferences.mutate({
                      jean_mcp_rate_limit_per_minute: Math.max(
                        0,
                        Math.min(1000, Number(e.target.value) || 0)
                      ),
                    })
                  }
                />
              </div>
            </div>

            <div className="space-y-3 rounded-md border px-4 py-3">
              <div className="space-y-1">
                <Label className="text-sm font-medium">
                  Automatic config install
                </Label>
                <p className="text-xs text-muted-foreground">
                  Jean safely merges its MCP server into installed CLI user
                  configs at startup
                  {installableLabels.length > 0
                    ? `: ${installableLabels.join(', ')}.`
                    : '. Install a supported CLI first.'}
                </p>
              </div>
              {configuredBackends.length > 0 && (
                <div
                  className="flex flex-wrap gap-2"
                  aria-label="Install status"
                >
                  {configuredBackends.map(backend => (
                    <span
                      key={backend}
                      className="inline-flex items-center gap-1.5 rounded-full border border-green-600/30 bg-green-600/10 px-2.5 py-1 text-xs text-green-700 dark:text-green-400"
                    >
                      <CheckCircle className="size-3.5" />
                      Installed in {BACKEND_LABELS[backend]}
                    </span>
                  ))}
                </div>
              )}
              <Button
                size="sm"
                onClick={() => handleInstall()}
                disabled={
                  installState === 'installing' ||
                  installState === 'success' ||
                  !serverRunning ||
                  installableBackends.length === 0
                }
                className={cn(
                  'w-full sm:w-auto sm:min-w-[11rem] sm:max-w-[20rem]',
                  installState === 'success' &&
                    'border-green-600 bg-green-600 text-white hover:bg-green-700'
                )}
                aria-live="polite"
                title={installMessage}
              >
                {transientButton ?? (
                  <span>Repair Jean MCP config ({modeLabel})</span>
                )}
              </Button>
            </div>

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Manual setup snippets
              </Label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {snippetTargets.map(target => (
                  <Button
                    key={target.id}
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      handleCopySnippet(target.label, target.content)
                    }
                    className="h-auto w-full justify-start gap-2 px-3 py-2.5 text-left"
                  >
                    <Copy className="mt-0.5 size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium leading-tight">
                        {target.label}
                      </span>
                      <span className="block truncate text-[11px] font-normal text-muted-foreground">
                        {target.path}
                      </span>
                    </span>
                  </Button>
                ))}
              </div>
            </div>
          </>
        )}
      </SettingsSection>
    </>
  )
}
