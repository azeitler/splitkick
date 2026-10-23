import { useCallback } from 'react'
import { Archive } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSidebarWidth } from '@/components/layout/SidebarWidthContext'
import { useIsMobile } from '@/hooks/use-mobile'
import { openArchivedView } from '@/lib/archived-view'
import { useUIStore } from '@/store/ui-store'
import { SIDEBAR_ROW_SELECTED, SIDEBAR_ROW_SHAPE } from './sidebar-row-styles'

/**
 * The Archived row, at the end of the sidebar's Projects list.
 *
 * A navigation row like Home: it opens the Archived view in the main area.
 * The phone layout has no main area beside the sidebar, so there it opens the
 * Archived dialog instead.
 */
export function SidebarArchivedRow() {
  const sidebarWidth = useSidebarWidth()
  const isMobile = useIsMobile()
  const isNarrow = sidebarWidth < 180
  const isActive = useUIStore(state => state.archivedViewOpen)

  const handleClick = useCallback(() => {
    if (isMobile) {
      useUIStore.getState().setLeftSidebarVisible(false)
      window.dispatchEvent(new CustomEvent('command:open-archived-modal'))
      return
    }
    openArchivedView()
  }, [isMobile])

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-current={isActive ? 'page' : undefined}
      title={isNarrow ? 'Archived' : undefined}
      data-testid="sidebar-archived-row"
      className={cn(
        'group relative flex cursor-pointer items-center gap-1 overflow-hidden px-2 py-1.5 text-left transition-colors duration-150',
        SIDEBAR_ROW_SHAPE,
        isNarrow && 'justify-center',
        isActive
          ? SIDEBAR_ROW_SELECTED
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
      )}
    >
      <Archive className="size-3.5 shrink-0" aria-hidden="true" />
      {!isNarrow && <span className="truncate text-sm">Archived</span>}
      {isNarrow && <span className="sr-only">Archived</span>}
    </button>
  )
}
