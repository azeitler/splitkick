import React, { useCallback, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle,
  ExternalLink,
  Loader2,
  ShieldAlert,
  TriangleAlert,
} from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useInstalledBackends } from '@/hooks/useInstalledBackends'
import { PRODUCT_NAME } from '@/lib/build-info'
import { isLocalBackend } from '@/lib/environment'
import { openExternal } from '@/lib/platform'
import { invoke } from '@/lib/transport'
import { invalidateAllMcpServers } from '@/services/mcp'
import type { CliBackend } from '@/types/preferences'
import { SettingsSection } from '../SettingsSection'
import { AgentBrowserPanel } from './AgentBrowserPanel'

export type BrowserEngine =
  | 'off'
  | 'agent_browser'
  | 'playwright'
  | 'playwright_extension'

interface HandMadeServer {
  backend: string
  serverName: string
  path: string
}

/** `get_browser_engine_status`. Never holds the token. */
export interface BrowserEngineStatus {
  engine: BrowserEngine
  hasToken: boolean
  managedInstall: boolean
  managedVersion: string | null
  nodePath: string | null
  extensionUrl: string
  installedBackends: string[]
  handMade: HandMadeServer[]
}

interface EngineApplyResult {
  backend: string
  status: 'installed' | 'removed' | 'unchanged' | 'conflict' | 'error'
  message: string
  conflicts: string[]
}

const WRITABLE_BACKENDS = [
  'claude',
  'codex',
  'opencode',
  'cursor',
  'grok',
  'kimi',
  'antigravity',
] as const satisfies readonly CliBackend[]

const ENGINES: { value: BrowserEngine; label: string; description: string }[] =
  [
    {
      value: 'off',
      label: 'Off',
      description: `${PRODUCT_NAME} adds no browser server to your CLIs.`,
    },
    {
      value: 'agent_browser',
      label: 'Agent Browser',
      description: `Vercel agent-browser with a ${PRODUCT_NAME}-managed Chromium profile. Works on servers too.`,
    },
    {
      value: 'playwright',
      label: 'Playwright',
      description:
        'Microsoft Playwright MCP with its own browser window and profile.',
    },
    {
      value: 'playwright_extension',
      label: 'Playwright with your Chrome',
      description:
        'Playwright MCP drives your logged-in Chrome through the Playwright extension.',
    },
  ]

export const STATUS_QUERY_KEY = ['browserEngineStatus']

function summarize(results: EngineApplyResult[]): string {
  const count = (status: EngineApplyResult['status']) =>
    results.filter(r => r.status === status).length
  const parts = [
    count('installed') && `added to ${count('installed')}`,
    count('removed') && `removed from ${count('removed')}`,
    count('conflict') && `${count('conflict')} with your own Playwright server`,
    count('error') && `${count('error')} failed`,
  ].filter(Boolean)
  return parts.length > 0 ? `Backends: ${parts.join(', ')}` : 'No change'
}

export const BrowserForAgentsSection: React.FC = () => {
  const queryClient = useQueryClient()
  const { installedBackends } = useInstalledBackends()
  const readOnly = !isLocalBackend()
  const [pendingEngine, setPendingEngine] = useState<BrowserEngine | null>(null)
  const [applying, setApplying] = useState(false)
  const [applyMessage, setApplyMessage] = useState('')
  const [token, setToken] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{
    ok: boolean
    text: string
  } | null>(null)
  const [installing, setInstalling] = useState(false)

  const { data: status, isLoading } = useQuery({
    queryKey: STATUS_QUERY_KEY,
    queryFn: () => invoke<BrowserEngineStatus>('get_browser_engine_status'),
    staleTime: 15_000,
  })
  // Undefined while loading: no engine panel until the status is known.
  const engine = status?.engine
  const backends = WRITABLE_BACKENDS.filter(b => installedBackends.includes(b))

  const applyEngine = useCallback(
    async (next: BrowserEngine, takeOver = false) => {
      setApplying(true)
      setApplyMessage('')
      setTestResult(null)
      try {
        const results = await invoke<EngineApplyResult[]>(
          'set_browser_engine',
          { engine: next, backends, takeOver }
        )
        setApplyMessage(summarize(results))
        const failed = results.filter(r => r.status === 'error')
        if (failed.length > 0) {
          toast.error(
            `Browser engine: ${failed.map(r => `${r.backend}: ${r.message}`).join('; ')}`
          )
        }
        invalidateAllMcpServers(undefined, backends)
        queryClient.invalidateQueries({ queryKey: ['preferences'] })
      } catch (e) {
        toast.error(`Failed to change the browser engine: ${e}`)
      } finally {
        await queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY })
        setApplying(false)
      }
    },
    [backends, queryClient]
  )

  const handleEngineChange = (value: string) => {
    const next = value as BrowserEngine
    if (next === engine) return
    if (next === 'playwright_extension') {
      setPendingEngine(next)
      return
    }
    void applyEngine(next)
  }

  const handleSaveToken = async (value: string) => {
    try {
      const saved = await invoke<boolean>('save_browser_extension_token', {
        token: value,
      })
      setToken('')
      toast.success(saved ? 'Token saved in the Keychain' : 'Token removed')
      await queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY })
    } catch (e) {
      toast.error(`Failed to save the token: ${e}`)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const text = await invoke<string>('test_browser_connection', {
        extension: engine === 'playwright_extension',
        token: token.trim() || null,
      })
      // Playwright MCP answers in Markdown; drop the heading marks.
      setTestResult({ ok: true, text: text.replace(/^#+\s*/gm, '') })
    } catch (e) {
      setTestResult({ ok: false, text: String(e) })
    } finally {
      setTesting(false)
    }
  }

  const handleInstall = async () => {
    setInstalling(true)
    const toastId = toast.loading('Installing Playwright MCP…')
    try {
      const next = await invoke<BrowserEngineStatus>('install_playwright_mcp')
      queryClient.setQueryData(STATUS_QUERY_KEY, next)
      toast.success('Playwright MCP installed', { id: toastId })
      // The entry stays the same; the launcher picks up the install.
    } catch (e) {
      toast.error(`Install failed: ${e}`, { id: toastId })
    } finally {
      setInstalling(false)
    }
  }

  const isPlaywright =
    engine === 'playwright' || engine === 'playwright_extension'
  const handMade = status?.handMade ?? []

  return (
    <SettingsSection
      title="Browser for agents"
      anchorId="pref-mcp-section-agent-browser"
    >
      <p className="text-sm text-muted-foreground">
        Choose the browser your coding agents can drive. {PRODUCT_NAME} adds it
        as an MCP server to every installed CLI (Claude, Codex, OpenCode,
        Cursor, Grok, Kimi, Antigravity).
      </p>

      {readOnly && (
        <p
          className="text-xs text-muted-foreground"
          data-testid="browser-engine-read-only"
        >
          Read-only here. Change it in the {PRODUCT_NAME} desktop app on the
          host.
        </p>
      )}

      <div className="space-y-4 rounded-md border px-4 py-3">
        {isLoading ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Checking browser engines…
          </span>
        ) : (
          <RadioGroup
            value={engine ?? ''}
            onValueChange={handleEngineChange}
            disabled={readOnly || applying}
            aria-label="Browser engine"
          >
            {ENGINES.map(option => (
              <div key={option.value} className="flex items-start gap-2">
                <RadioGroupItem
                  value={option.value}
                  id={`browser-engine-${option.value}`}
                  aria-describedby={`browser-engine-${option.value}-hint`}
                  className="mt-0.5"
                />
                <div className="flex flex-col gap-0.5">
                  <Label
                    htmlFor={`browser-engine-${option.value}`}
                    className="text-sm font-medium"
                  >
                    {option.label}
                  </Label>
                  <span
                    id={`browser-engine-${option.value}-hint`}
                    className="text-xs text-muted-foreground"
                  >
                    {option.description}
                  </span>
                </div>
              </div>
            ))}
          </RadioGroup>
        )}

        {(applying || applyMessage) && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {applying && <Loader2 className="size-3.5 animate-spin" />}
            {applying ? 'Updating your CLI configs…' : applyMessage}
          </p>
        )}

        {handMade.length > 0 && (
          <Alert data-testid="browser-engine-hand-made">
            <TriangleAlert />
            <AlertTitle>You already set up Playwright yourself</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4">
                {handMade.map(server => (
                  <li key={`${server.backend}:${server.serverName}`}>
                    {server.backend}: <code>{server.serverName}</code>
                  </li>
                ))}
              </ul>
              {isPlaywright ? (
                <p>
                  {PRODUCT_NAME} did not add a second Playwright server there.
                  Take them over to let {PRODUCT_NAME} manage them (a backup of
                  each config is kept).
                </p>
              ) : (
                <p>
                  Choose a Playwright engine to take them over, or leave them as
                  they are.
                </p>
              )}
              {isPlaywright && !readOnly && (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="mt-2"
                  disabled={applying}
                  onClick={() => engine && void applyEngine(engine, true)}
                >
                  Take over
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}

        {engine === 'playwright_extension' && (
          <Alert variant="destructive" data-testid="browser-engine-warning">
            <ShieldAlert />
            <AlertTitle>Agents act in your real browser</AlertTitle>
            <AlertDescription>
              Agents can open, read and click anything in your logged-in Chrome:
              mail, banking, admin panels. Use it only with agents and prompts
              you trust.
            </AlertDescription>
          </Alert>
        )}

        {engine === 'playwright_extension' && (
          <div className="space-y-2">
            <Label htmlFor="browser-extension-token">Connection token</Label>
            <p className="text-xs text-muted-foreground">
              Install the Playwright extension in Chrome, open it and copy the
              token. {PRODUCT_NAME} keeps it in the macOS Keychain and passes it
              to Playwright MCP through the environment only.
            </p>
            <Button
              type="button"
              size="sm"
              variant="link"
              className="h-auto px-0"
              onClick={() => {
                if (status?.extensionUrl) {
                  openExternal(status.extensionUrl).catch(e =>
                    toast.error(`Failed to open the Chrome Web Store: ${e}`)
                  )
                }
              }}
            >
              <ExternalLink className="size-3.5" />
              Get the Playwright extension
            </Button>
            {!readOnly && (
              <div className="flex flex-wrap gap-2">
                <Input
                  id="browser-extension-token"
                  type="password"
                  autoComplete="off"
                  className="max-w-sm"
                  value={token}
                  placeholder={
                    status?.hasToken
                      ? 'Saved in the Keychain — paste to replace'
                      : 'Paste the token from the extension'
                  }
                  onChange={e => setToken(e.target.value)}
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={!token.trim()}
                  onClick={() => void handleSaveToken(token)}
                >
                  Save token
                </Button>
                {status?.hasToken && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void handleSaveToken('')}
                  >
                    Remove token
                  </Button>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {status?.hasToken
                ? 'A token is saved.'
                : 'No token saved: the extension asks you to approve each connection.'}
            </p>
          </div>
        )}

        {isPlaywright && (
          <div className="space-y-2 text-xs text-muted-foreground">
            <div>
              <span className="font-medium text-foreground">Starts with: </span>
              {status?.managedInstall
                ? `${PRODUCT_NAME}-managed @playwright/mcp ${status.managedVersion ?? ''}`
                : 'npx @playwright/mcp@latest'}
            </div>
            <div>
              <span className="font-medium text-foreground">Node.js: </span>
              {status?.nodePath ?? 'not found on PATH (needs Node 18 or newer)'}
            </div>
            {!readOnly && (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={testing}
                  onClick={() => void handleTest()}
                >
                  {testing ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" />
                      Testing…
                    </>
                  ) : (
                    'Test connection'
                  )}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={installing}
                  onClick={() => void handleInstall()}
                >
                  {status?.managedInstall
                    ? 'Update Playwright MCP'
                    : 'Install Playwright MCP'}
                </Button>
              </div>
            )}
            {testResult && (
              <p
                className={
                  testResult.ok
                    ? 'flex items-start gap-1.5 text-green-600 dark:text-green-400'
                    : 'text-red-600 dark:text-red-400'
                }
              >
                {testResult.ok && <CheckCircle className="mt-0.5 size-3.5" />}
                <span className="whitespace-pre-wrap">
                  {testResult.ok
                    ? `Connected. ${testResult.text}`
                    : testResult.text}
                </span>
              </p>
            )}
          </div>
        )}

        {engine === 'agent_browser' && (
          <AgentBrowserPanel
            readOnly={readOnly}
            onInstalled={() => void applyEngine('agent_browser')}
          />
        )}
      </div>

      <AlertDialog
        open={pendingEngine !== null}
        onOpenChange={open => {
          if (!open) setPendingEngine(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Let agents use your Chrome?</AlertDialogTitle>
            <AlertDialogDescription>
              Agents can act in your real, logged-in browser: read your mail,
              click buttons and send forms on any site where you are signed in.
              Turn this on only if you trust the agents you run.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const next = pendingEngine
                setPendingEngine(null)
                if (next) void applyEngine(next)
              }}
            >
              Use my Chrome
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  )
}
