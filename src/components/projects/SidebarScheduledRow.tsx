import { useCallback } from 'react'
import { CalendarClock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSidebarWidth } from '@/components/layout/SidebarWidthContext'
import { useIsMobile } from '@/hooks/use-mobile'
import { openScheduledView } from '@/lib/scheduled-view'
import { useSchedules } from '@/services/schedules'
import { useUIStore } from '@/store/ui-store'
import { SIDEBAR_ROW_SELECTED, SIDEBAR_ROW_SHAPE } from './sidebar-row-styles'

/**
 * The Scheduled row, above Archived at the end of the Projects list (#38).
 * A navigation row like Archived: it opens the Scheduled view, the list of
 * schedules across projects. The count is the active (not paused) ones.
 */
export function SidebarScheduledRow() {
  const sidebarWidth = useSidebarWidth()
  const isMobile = useIsMobile()
  const isNarrow = sidebarWidth < 180
  const isActive = useUIStore(state => state.scheduledViewOpen)
  const { data: schedules } = useSchedules()
  const activeCount = (schedules ?? []).filter(s => s.enabled !== false).length

  const handleClick = useCallback(() => {
    openScheduledView()
    if (isMobile) useUIStore.getState().setLeftSidebarVisible(false)
  }, [isMobile])

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-current={isActive ? 'page' : undefined}
      title={isNarrow ? 'Scheduled' : undefined}
      data-testid="sidebar-scheduled-row"
      className={cn(
        'group relative flex cursor-pointer items-center gap-1 overflow-hidden px-2 py-1.5 text-left transition-colors duration-150',
        SIDEBAR_ROW_SHAPE,
        isNarrow && 'justify-center',
        isActive
          ? SIDEBAR_ROW_SELECTED
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
      )}
    >
      <CalendarClock className="size-3.5 shrink-0" aria-hidden="true" />
      {!isNarrow && <span className="truncate text-sm">Scheduled</span>}
      {!isNarrow && activeCount > 0 && (
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {activeCount}
        </span>
      )}
      {isNarrow && <span className="sr-only">Scheduled</span>}
    </button>
  )
}
