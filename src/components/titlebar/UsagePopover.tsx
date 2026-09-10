import { useCallback, useState } from 'react'
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
  usageSeverity,
  type UsageSeverity,
} from '@/components/preferences/panes/UsagePane'
import {
  useClaudeCliAuth,
  useClaudeCliStatus,
  useClaudeUsage,
} from '@/services/claude-cli'
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
import { useUIStore } from '@/store/ui-store'
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

/**
 * Session and weekly windows of every signed-in backend, reduced to the
 * highest one. Shares its query keys with the dock badge and the Settings
 * pane, so it adds no backend calls of its own.
 */
function usePeakUsage(fetchEnabled: boolean): PeakUsage | null {
  const claudeStatus = useClaudeCliStatus()
  const claudeAuth = useClaudeCliAuth({
    enabled: !!claudeStatus.data?.installed,
  })
  const claudeReady =
    !!claudeStatus.data?.installed && !!claudeAuth.data?.authenticated
  const claudeUsage = useClaudeUsage({ enabled: claudeReady && fetchEnabled })

  const codexStatus = useCodexCliStatus()
  const codexAuth = useCodexCliAuth({ enabled: !!codexStatus.data?.installed })
  const codexReady =
    !!codexStatus.data?.installed && !!codexAuth.data?.authenticated
  const codexUsage = useCodexUsage({ enabled: codexReady && fetchEnabled })

  const grokStatus = useGrokCliStatus()
  const grokAuth = useGrokCliAuth({ enabled: !!grokStatus.data?.installed })
  const grokReady =
    !!grokStatus.data?.installed && !!grokAuth.data?.authenticated
  const grokUsage = useGrokUsage({ enabled: grokReady && fetchEnabled })

  const claude = claudeReady ? claudeUsage.data : undefined
  const codex = codexReady ? codexUsage.data : undefined
  const grok = grokReady ? grokUsage.data : undefined

  return findPeakUsage([
    { label: 'Claude · Session', usage: claude?.session },
    { label: 'Claude · Weekly', usage: claude?.weekly },
    { label: 'Codex · Session', usage: codex?.session },
    { label: 'Codex · Weekly', usage: codex?.weekly },
    { label: 'Grok · Build', usage: grok?.session },
    { label: 'Grok · Weekly credits', usage: grok?.weekly },
  ])
}

const RING_CLASS: Record<UsageSeverity, string> = {
  normal: 'text-primary',
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
  const peak = usePeakUsage(!import.meta.env.DEV || open)
  const rounded = peak ? Math.round(peak.percent) : null

  const openSettings = useCallback(() => {
    setOpen(false)
    useUIStore.getState().openPreferencesPane('usage')
  }, [])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              aria-label={peak ? `Usage, ${peak.label} ${rounded}%` : 'Usage'}
              data-testid="titlebar-usage"
              className={cn(
                'h-6 gap-1 rounded-md bg-muted/40 px-1.5 text-[0.625rem] font-medium tabular-nums text-foreground/70 hover:bg-muted hover:text-foreground',
                open && 'bg-muted text-foreground'
              )}
            >
              {peak ? (
                <>
                  <UsageRing percent={peak.percent} />
                  <span>{rounded}%</span>
                </>
              ) : (
                <BarChart3 className="size-3.5" />
              )}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {peak ? `Usage · ${peak.label} ${rounded}%` : 'Usage'}
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
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 px-1.5 text-[11px]"
            onClick={openSettings}
          >
            Settings
          </Button>
        </div>
        <UsagePane withSectionIds={false} />
      </PopoverContent>
    </Popover>
  )
}

export default UsagePopover
