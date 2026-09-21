import { useCallback } from 'react'
import { House } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSidebarWidth } from '@/components/layout/SidebarWidthContext'
import { useIsHomeActive } from '@/components/home/useIsHomeActive'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import { useIsMobile } from '@/hooks/use-mobile'

/**
 * The Home row, stuck to the top of the sidebar.
 *
 * Home is the state where no project and no worktree is selected, so the row
 * only has to clear both. That keeps the view in step with the existing
 * `active_project_id` persistence, without a second source of truth.
 *
 * Geometry: the 14px glyph sits on the 12px inset shared by the section
 * headers and the folder glyphs directly beneath it, and the 4px gap puts the
 * label on the same column as the project names.
 */
export function SidebarHomeRow() {
  const sidebarWidth = useSidebarWidth()
  const isMobile = useIsMobile()
  const isNarrow = sidebarWidth < 180
  const isActive = useIsHomeActive()

  const handleClick = useCallback(() => {
    useProjectsStore.getState().selectProject(null)
    useChatStore.getState().clearActiveWorktree()
    if (isMobile) {
      useUIStore.getState().setLeftSidebarVisible(false)
    }
  }, [isMobile])

  return (
    // The opaque wrapper covers the tree as it scrolls underneath; the row's
    // own selected tint is translucent and would let it show through.
    <div className="sticky top-0 z-10 bg-sidebar">
      <button
        type="button"
        onClick={handleClick}
        aria-current={isActive ? 'page' : undefined}
        title={isNarrow ? 'Home' : undefined}
        data-testid="sidebar-home-row"
        className={cn(
          'group relative flex w-full cursor-pointer items-center gap-1 overflow-hidden px-3 py-1.5 text-left transition-colors duration-150',
          isNarrow && 'justify-center',
          isActive
            ? 'bg-primary/10 text-foreground before:absolute before:left-0 before:top-0 before:h-full before:w-[3px] before:bg-primary'
            : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
        )}
      >
        <House className="size-3.5 shrink-0" aria-hidden="true" />
        {!isNarrow && <span className="truncate text-sm">Home</span>}
        {isNarrow && <span className="sr-only">Home</span>}
      </button>
    </div>
  )
}
