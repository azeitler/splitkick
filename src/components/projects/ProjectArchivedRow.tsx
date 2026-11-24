import { useCallback } from 'react'
import { Archive } from 'lucide-react'
import { useArchivedCount } from '@/components/archive/useArchivedCount'
import { useIsMobile } from '@/hooks/use-mobile'
import { openArchivedView, type OpenArchivedDetail } from '@/lib/archived-view'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/store/ui-store'
import { CollapsedCountBadge } from './CollapsedCountBadge'
import {
  SIDEBAR_NESTED_ROW_SHAPE,
  SIDEBAR_WORKTREE_ROW_PADDING,
} from './sidebar-row-styles'

interface ProjectArchivedRowProps {
  projectId: string
}

/**
 * The project's Archived row, the last child in the sidebar tree. It opens
 * the Archived view filtered to the project and switches the sidebar to its
 * Archived tab, which then marks the project (a dialog on a phone). Hidden
 * when the project has nothing archived. The count is the view's "All":
 * archived worktrees and sessions.
 */
export function ProjectArchivedRow({ projectId }: ProjectArchivedRowProps) {
  const count = useArchivedCount(projectId)
  const isMobile = useIsMobile()

  // Like the Archived row: the dialog on a phone, which has no main area.
  const handleClick = useCallback(() => {
    if (!isMobile) {
      openArchivedView(projectId)
      return
    }
    useUIStore.getState().setLeftSidebarVisible(false)
    window.dispatchEvent(
      new CustomEvent<OpenArchivedDetail>('command:open-archived-modal', {
        detail: { projectId },
      })
    )
  }, [isMobile, projectId])

  if (count === 0) return null

  return (
    <button
      type="button"
      onClick={handleClick}
      data-testid={`project-archived-row-${projectId}`}
      className={cn(
        'flex h-[var(--sb-sec-h,2rem)] cursor-pointer items-center gap-1.5 overflow-hidden py-1.5 text-left text-sm transition-colors duration-150',
        SIDEBAR_NESTED_ROW_SHAPE,
        SIDEBAR_WORKTREE_ROW_PADDING,
        'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
      )}
    >
      <Archive className="size-2.5 shrink-0" aria-hidden="true" />
      <span className="truncate">Archived</span>
      <CollapsedCountBadge count={count} noun="archived item" />
    </button>
  )
}
