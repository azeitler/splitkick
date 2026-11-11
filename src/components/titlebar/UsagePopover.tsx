import { createElement, useCallback, useState } from 'react'
import { BarChart3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  UsagePane,
  clampPercent,
  claudeModelLimits,
  usageSeverity,
  type UsageSeverity,
} from '@/components/preferences/panes/UsagePane'
import {
  useClaudeAccountAuth,
  useClaudeCliStatus,
  useClaudeUsage,
} from '@/services/claude-cli'
import { usePreferences } from '@/services/preferences'
import { activeClaudeAccount, listClaudeAccounts } from '@/lib/claude-accounts'
import {
  useCodexCliAuth,
  useCodexCliStatus,
  useCodexUsage,
} from '@/services/codex-cli'
import {
  useGrokCliAuth,
  useGrokCliStatus,
  useGrokUsage,
} from '@/services/grok-cli'
import { useSession } from '@/services/chat'
import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'
import { getBackendIcon } from '@/components/ui/backend-label'
import { resolveSelectedModelForBackend } from '@/lib/session-defaults'
import type { CliBackend } from '@/types/preferences'
import { cn } from '@/lib/utils'

interface UsageWindowCandidate {
  label: string
  usage: { usedPercent: number } | null | undefined
}

export interface PeakUsage {
  label: string
  percent: number
}

/** The window closest to its limit, or null when no window has data. */
export function findPeakUsage(
  candidates: UsageWindowCandidate[]
): PeakUsage | null {
  let peak: PeakUsage | null = null
  for (const { label, usage } of candidates) {
    if (!usage) continue
    const percent = clampPercent(usage.usedPercent)
    if (!peak || percent > peak.percent) peak = { label, percent }
  }
  return peak
}

export interface UsageBadge {
  /** The backend the badge is about. */
  backend: CliBackend
  /** The figure of that backend, or null when it has no usage data. */
  peak: PeakUsage | null
  /** How many other signed-in backends the popover also shows. */
  otherBackends: number
}

/**
 * What the usage badge shows: the backend of the open session (else the
 * default backend) and, for Claude, the active account: every Claude run uses
 * it, old sessions too (#131). The
 * figure is the fuller of that account's session and weekly windows. Shares
 * its query keys with the Usage pane, so it adds no backend calls of its own.
 */
export function useUsageBadge(fetchEnabled: boolean): UsageBadge {
  const modalOpen = useUIStore(state => state.sessionChatModalOpen)
  const modalWorktreeId = useUIStore(state => state.sessionChatModalWorktreeId)
  const worktreeId = useChatStore(state =>
    modalOpen && modalWorktreeId ? modalWorktreeId : state.activeWorktreeId
  )
  const worktreePath = useChatStore(state =>
    worktreeId ? (state.worktreePaths[worktreeId] ?? null) : null
  )
  const sessionId = useChatStore(state =>
    worktreeId ? (state.activeSessionIds[worktreeId] ?? null) : null
  )
  const selectedBackend = useChatStore(state =>
    sessionId ? state.selectedBackends[sessionId] : undefined
  )
  const toolbarModel = useChatStore(state =>
    sessionId ? state.selectedModels[sessionId] : undefined
  )
  const { data: session } = useSession(sessionId, worktreeId, worktreePath)
  const { data: preferences } = usePreferences()

  const backend: CliBackend =
    (session?.backend as CliBackend | undefined) ??
    selectedBackend ??
    preferences?.default_backend ??
    'claude'
  // The model the open session uses (toolbar choice first, as the chat does).
  // A model limit counts only for its own model: a full Fable limit does not
  // block an Opus session.
  const model = resolveSelectedModelForBackend(
    backend,
    toolbarModel ?? session?.selected_model,
    preferences
  )

  const claudeAccounts = listClaudeAccounts(preferences)
  const claudeAccount = activeClaudeAccount(preferences)
  const claudeStatus = useClaudeCliStatus()
  const claudeAuth = useClaudeAccountAuth(claudeAccount.id, {
    enabled: !!claudeStatus.data?.installed,
  })
  const claudeReady =
    !!claudeStatus.data?.installed && !!claudeAuth.data?.authenticated
  const claudeUsage = useClaudeUsage({
    accountId: claudeAccount.id,
    enabled: backend === 'claude' && claudeReady && fetchEnabled,
  })

  const codexStatus = useCodexCliStatus()
  const codexAuth = useCodexCliAuth({ enabled: !!codexStatus.data?.installed })
  const codexReady =
    !!codexStatus.data?.installed && !!codexAuth.data?.authenticated
  const codexUsage = useCodexUsage({
    enabled: backend === 'codex' && codexReady && fetchEnabled,
  })

  const grokStatus = useGrokCliStatus()
  const grokAuth = useGrokCliAuth({ enabled: !!grokStatus.data?.installed })
  const grokReady =
    !!grokStatus.data?.installed && !!grokAuth.data?.authenticated
  const grokUsage = useGrokUsage({
    enabled: backend === 'grok' && grokReady && fetchEnabled,
  })

  const otherBackends = (
    [
      ['claude', claudeReady],
      ['codex', codexReady],
      ['grok', grokReady],
    ] as const
  ).filter(([name, ready]) => ready && name !== backend).length

  let candidates: UsageWindowCandidate[] = []
  if (backend === 'claude' && claudeReady) {
    const prefix =
      claudeAccounts.length > 1 ? `Claude ${claudeAccount.label}` : 'Claude'
    const data = claudeUsage.data
    candidates = [
      { label: `${prefix} · Session`, usage: data?.session },
      { label: `${prefix} · Weekly`, usage: data?.weekly },
      // A full model limit (e.g. Fable) blocks that model's runs too.
      ...(data ? claudeModelLimits(data) : [])
        .filter(limit => limitAppliesToModel(limit.label, model))
        .map(limit => ({
          label: `${prefix} · ${limit.label}`,
          usage: limit.usage,
        })),
    ]
  } else if (backend === 'codex' && codexReady) {
    candidates = [
      { label: 'Codex · Session', usage: codexUsage.data?.session },
      { label: 'Codex · Weekly', usage: codexUsage.data?.weekly },
    ]
  } else if (backend === 'grok' && grokReady) {
    candidates = [
      { label: 'Grok · Build', usage: grokUsage.data?.session },
      { label: 'Grok · Weekly credits', usage: grokUsage.data?.weekly },
    ]
  }

  return { backend, peak: findPeakUsage(candidates), otherBackends }
}

/**
 * Whether a model limit ("Fable", "Sonnet") applies to `model`
 * (`claude-fable-5-1`, `fable`, `claude-sonnet-4-6[1m]`).
 */
export function limitAppliesToModel(
  limitLabel: string,
  model: string
): boolean {
  return model.toLowerCase().includes(limitLabel.toLowerCase())
}

/** The badge figure alone, for the mobile tab icon. */
export function usePeakUsage(fetchEnabled: boolean): PeakUsage | null {
  return useUsageBadge(fetchEnabled).peak
}

export const RING_CLASS: Record<UsageSeverity, string> = {
  normal: 'text-green-500',
  warning: 'text-amber-500',
  critical: 'text-destructive',
}

const RING_RADIUS = 5
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

function UsageRing({ percent }: { percent: number }) {
  return (
    <svg
      viewBox="0 0 14 14"
      className={cn(
        'size-3.5 shrink-0 -rotate-90',
        RING_CLASS[usageSeverity(percent)]
      )}
      aria-hidden
    >
      <circle
        cx="7"
        cy="7"
        r={RING_RADIUS}
        fill="none"
        strokeWidth="2"
        className="stroke-foreground/15"
      />
      {percent > 0 ? (
        <circle
          cx="7"
          cy="7"
          r={RING_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={RING_CIRCUMFERENCE * (1 - percent / 100)}
          className="transition-[stroke-dashoffset] duration-300"
        />
      ) : null}
    </svg>
  )
}

/**
 * Title bar badge with the highest plan-limit figure across signed-in
 * backends. A click opens the full Usage pane in a popover.
 */
export function UsagePopover() {
  const [open, setOpen] = useState(false)
  // Same gate as the dock badge: dev builds only fetch on demand, so a
  // restart loop does not hit the usage endpoints' rate limits.
  const { backend, peak, otherBackends } = useUsageBadge(
    !import.meta.env.DEV || open
  )
  const rounded = peak ? Math.round(peak.percent) : null
  const moreLabel =
    otherBackends > 0
      ? `${otherBackends} more ${otherBackends === 1 ? 'backend' : 'backends'}`
      : null

  const openSettings = useCallback(() => {
    setOpen(false)
    useUIStore.getState().openPreferencesPane('usage')
  }, [])

  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                aria-label={[
                  peak ? `Usage, ${peak.label} ${rounded}%` : 'Usage',
                  moreLabel,
                ]
                  .filter(Boolean)
                  .join(', ')}
                data-testid="titlebar-usage"
                className={cn(
                  'h-6 rounded-md bg-card text-[0.625rem] font-medium tabular-nums text-foreground/80 shadow-xs hover:bg-muted hover:text-foreground',
                  peak
                    ? 'gap-0 overflow-hidden px-0 py-0'
                    : 'gap-1 px-1 has-[>svg]:px-1',
                  open && 'bg-muted text-foreground'
                )}
              >
                {peak ? (
                  <>
                    <span
                      data-testid="titlebar-usage-header"
                      className="flex items-center self-stretch bg-border px-1 dark:bg-input"
                    >
                      {createElement(getBackendIcon(backend), {
                        className: 'size-3',
                        'aria-hidden': true,
                      })}
                    </span>
                    <span className="flex items-center gap-1 px-1">
                      <UsageRing percent={peak.percent} />
                      <span>{rounded}%</span>
                    </span>
                  </>
                ) : (
                  <BarChart3 className="size-3.5" />
                )}
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>
            {[peak ? `Usage · ${peak.label} ${rounded}%` : 'Usage', moreLabel]
              .filter(Boolean)
              .join(' · ')}
          </TooltipContent>
        </Tooltip>
        <PopoverContent
          align="start"
          side="bottom"
          sideOffset={4}
          className="max-h-[70vh] w-[22rem] overflow-y-auto p-3"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-foreground">Usage</span>
            <Button
              variant="outline"
              size="sm"
              className="h-6 shrink-0 px-2 text-[11px]"
              onClick={openSettings}
            >
              Settings
            </Button>
          </div>
          <UsagePane withSectionIds={false} />
        </PopoverContent>
      </Popover>
      {otherBackends > 0 ? (
        <span
          data-testid="titlebar-usage-more"
          title={moreLabel ?? undefined}
          aria-hidden
          className="text-[0.625rem] font-medium tabular-nums text-muted-foreground"
        >
          +{otherBackends}
        </span>
      ) : null}
    </div>
  )
}

export default UsagePopover
