import React, { useCallback, useEffect, useState } from 'react'
import { Copy, Eye, EyeOff, RefreshCw } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { usePreferences, useSavePreferences } from '@/services/preferences'
import { invoke } from '@/lib/transport'
import { toast } from 'sonner'
import { isNativeApp } from '@/lib/environment'

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

const InlineField: React.FC<{
  label: string
  description?: React.ReactNode
  children: React.ReactNode
}> = ({ label, description, children }) => (
  <div className="flex items-center gap-4">
    <div className="w-96 shrink-0 space-y-0.5">
      <Label className="text-sm text-foreground">{label}</Label>
      {description && (
        <div className="text-xs text-muted-foreground">{description}</div>
      )}
    </div>
    {children}
  </div>
)

interface ServerStatus {
  running: boolean
  port: number | null
  address: string | null
  token: string | null
}

export const WebAccessPane: React.FC = () => {
  const { data: preferences } = usePreferences()
  const savePreferences = useSavePreferences()
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null)
  const [tokenVisible, setTokenVisible] = useState(false)
  const [isToggling, setIsToggling] = useState(false)

  // Poll server status
  const refreshStatus = useCallback(async () => {
    if (!isNativeApp()) return
    try {
      const status = await invoke<ServerStatus>('get_http_server_status')
      setServerStatus(status)
    } catch {
      // Ignore errors
    }
  }, [])

  useEffect(() => {
    refreshStatus()
    const interval = setInterval(refreshStatus, 3000)
    return () => clearInterval(interval)
  }, [refreshStatus])

  const handleToggleServer = useCallback(async () => {
    if (!preferences) return
    setIsToggling(true)
    try {
      if (serverStatus?.running) {
        await invoke('stop_http_server')
        toast.success('HTTP server stopped')
      } else {
        await invoke('start_http_server')
        toast.success('HTTP server started')
      }
      await refreshStatus()
    } catch (error) {
      toast.error(`Failed: ${error}`)
    } finally {
      setIsToggling(false)
    }
  }, [preferences, serverStatus?.running, refreshStatus])

  const handlePortChange = useCallback(
    (value: string) => {
      const port = parseInt(value, 10)
      if (preferences && !isNaN(port) && port >= 1024 && port <= 65535) {
        savePreferences.mutate({ ...preferences, http_server_port: port })
      }
    },
    [savePreferences, preferences]
  )

  const handleRegenerateToken = useCallback(async () => {
    try {
      const newToken = await invoke<string>('regenerate_http_token')
      if (preferences) {
        savePreferences.mutate({ ...preferences, http_server_token: newToken })
      }
      await refreshStatus()
      toast.success('Token regenerated')
    } catch (error) {
      toast.error(`Failed to regenerate token: ${error}`)
    }
  }, [savePreferences, preferences, refreshStatus])

  const handleCopyUrl = useCallback(() => {
    if (!serverStatus?.address || !serverStatus?.token) return
    const url = `http://${serverStatus.address}:${serverStatus.port}?token=${serverStatus.token}`
    navigator.clipboard.writeText(url)
    toast.success('URL copied to clipboard')
  }, [serverStatus])

  const handleCopyToken = useCallback(() => {
    if (!serverStatus?.token) return
    navigator.clipboard.writeText(serverStatus.token)
    toast.success('Token copied to clipboard')
  }, [serverStatus])

  if (!isNativeApp()) {
    return (
      <div className="space-y-6">
        <div className="rounded-lg border border-muted p-4">
          <p className="text-sm text-muted-foreground">
            Web Access settings are only available in the desktop app.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-muted p-4">
        <p className="text-sm text-muted-foreground">
          Enable HTTP server to access Jean from a web browser on your local
          network. All commands are routed over WebSocket with token
          authentication.
        </p>
      </div>

      <SettingsSection title="Server">
        <div className="space-y-4">
          <InlineField
            label="Enable HTTP server"
            description="Start an HTTP + WebSocket server for browser access"
          >
            <div className="flex items-center gap-3">
              <Switch
                checked={serverStatus?.running ?? false}
                onCheckedChange={handleToggleServer}
                disabled={isToggling}
              />
              <div className="flex items-center gap-1.5">
                <div
                  className={`h-2 w-2 rounded-full ${
                    serverStatus?.running
                      ? 'bg-green-500'
                      : 'bg-muted-foreground/40'
                  }`}
                />
                <span className="text-xs text-muted-foreground">
                  {serverStatus?.running ? 'Running' : 'Stopped'}
                </span>
              </div>
            </div>
          </InlineField>

          <InlineField
            label="Port"
            description="Port number for the HTTP server (1024-65535)"
          >
            <Input
              type="number"
              min={1024}
              max={65535}
              className="w-28"
              value={preferences?.http_server_port ?? 3456}
              onChange={e => handlePortChange(e.target.value)}
              disabled={serverStatus?.running}
            />
          </InlineField>

          <InlineField
            label="Auto-start"
            description="Start the HTTP server automatically when Jean launches"
          >
            <Switch
              checked={preferences?.http_server_auto_start ?? false}
              onCheckedChange={checked => {
                if (preferences) {
                  savePreferences.mutate({
                    ...preferences,
                    http_server_auto_start: checked,
                  })
                }
              }}
            />
          </InlineField>
        </div>
      </SettingsSection>

      <SettingsSection title="Authentication">
        <div className="space-y-4">
          <InlineField
            label="Access token"
            description="Token required to connect via browser"
          >
            <div className="flex items-center gap-2">
              <Input
                type={tokenVisible ? 'text' : 'password'}
                className="w-64 font-mono text-xs"
                value={serverStatus?.token ?? ''}
                readOnly
              />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setTokenVisible(!tokenVisible)}
              >
                {tokenVisible ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
              <Button variant="ghost" size="icon" onClick={handleCopyToken}>
                <Copy className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleRegenerateToken}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </InlineField>

          {serverStatus?.running && serverStatus?.address && (
            <InlineField
              label="Access URL"
              description="Open this URL in a browser on your network"
            >
              <div className="flex items-center gap-2">
                <code className="rounded bg-muted px-2 py-1 text-xs font-mono">
                  http://{serverStatus.address}:{serverStatus.port}
                </code>
                <Button variant="ghost" size="icon" onClick={handleCopyUrl}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </InlineField>
          )}
        </div>
      </SettingsSection>
    </div>
  )
}
