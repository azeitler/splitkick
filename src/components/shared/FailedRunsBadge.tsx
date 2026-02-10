import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Activity } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWorkflowRuns } from '@/services/github'
import { ghCliQueryKeys } from '@/services/gh-cli'
import { useUIStore } from '@/store/ui-store'
import type { GhAuthStatus } from '@/types/gh-cli'

const BADGE_STALE_TIME = 5 * 60 * 1000 // 5 minutes — background badge, not active UI

interface FailedRunsBadgeProps {
  projectPath: string
  branch?: string
  className?: string
}

export function FailedRunsBadge({
  projectPath,
  branch,
  className,
}: FailedRunsBadgeProps) {
  const queryClient = useQueryClient()
  const authData = queryClient.getQueryData<GhAuthStatus>(ghCliQueryKeys.auth())
  const isAuthenticated = authData?.authenticated ?? false

  const { data: result } = useWorkflowRuns(projectPath, branch, {
    enabled: isAuthenticated,
    staleTime: BADGE_STALE_TIME,
  })

  const totalRuns = result?.runs.length ?? 0
  const failedCount = result?.failedCount ?? 0

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      const { setWorkflowRunsModalOpen } = useUIStore.getState()
      setWorkflowRunsModalOpen(true, projectPath, branch)
    },
    [projectPath, branch]
  )

  if (totalRuns === 0) return null

  // Red badge with count when there are failures
  if (failedCount > 0) {
    return (
      <button
        onClick={handleClick}
        className={cn(
          'shrink-0 rounded bg-red-500/10 px-1.5 py-0.5 text-[11px] font-medium text-red-600 transition-colors hover:bg-red-500/20',
          className
        )}
        title={`${failedCount} failed workflow run${failedCount > 1 ? 's' : ''}`}
      >
        <span className="flex items-center gap-0.5">
          <AlertCircle className="h-3 w-3" />
          {failedCount}
        </span>
      </button>
    )
  }

  // Subtle icon-only button to open modal when all runs are passing
  return (
    <button
      onClick={handleClick}
      className={cn(
        'shrink-0 rounded px-1 py-0.5 text-[11px] text-muted-foreground/50 transition-colors hover:bg-accent hover:text-muted-foreground',
        className
      )}
      title="View workflow runs"
    >
      <Activity className="h-3 w-3" />
    </button>
  )
}
