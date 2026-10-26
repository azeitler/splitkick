import { memo } from 'react'
import { Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { LimitHit } from '@/types/chat'
import { formatLimitHit } from './limit-hit'

interface LimitHitBannerProps {
  limit: LimitHit
  /** Sends "continue" so Claude picks up where it stopped */
  onResume: () => void
  /** Focuses the composer so the user can write their own follow-up */
  onResumeWithMessage: () => void
}

/**
 * Shown when Claude stopped the last run at the usage (session) limit.
 * Goes away once a new run starts.
 */
export const LimitHitBanner = memo(function LimitHitBanner({
  limit,
  onResume,
  onResumeWithMessage,
}: LimitHitBannerProps) {
  return (
    <div className="mx-auto max-w-7xl px-4 pb-2 md:px-6">
      <div
        data-testid="limit-hit-banner"
        className="flex flex-wrap items-center gap-2 rounded border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400"
      >
        <Zap className="h-4 w-4 shrink-0 fill-current" />
        <p className="min-w-0 flex-1 font-medium">{formatLimitHit(limit)}</p>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="outline" onClick={onResumeWithMessage}>
            Resume with message
          </Button>
          <Button size="sm" onClick={onResume}>
            Resume
          </Button>
        </div>
      </div>
    </div>
  )
})
