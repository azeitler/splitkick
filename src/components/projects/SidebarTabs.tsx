import { cn } from '@/lib/utils'
import { useUIStore } from '@/store/ui-store'
import type { SidebarTab } from '@/types/ui-state'

const TABS: { id: SidebarTab; label: string }[] = [
  { id: 'projects', label: 'Projects' },
  { id: 'recent', label: 'Recent' },
]

/**
 * The Projects / Recent switch below the Home row.
 *
 * Recent is a jump list of the latest sessions across every project, so an
 * active session is one click away without scrolling the tree. The choice is
 * persisted with the rest of the UI state.
 */
export function SidebarTabs() {
  const selectedTab = useUIStore(state => state.sidebarTab)

  return (
    <div
      role="tablist"
      aria-label="Sidebar"
      data-testid="sidebar-tabs"
      // A macOS segmented control: a faint track, the selected segment raised
      // (white in light mode, lighter gray in dark). Tokens relative to the
      // foreground, so the track stays visible on any sidebar color.
      className="mx-2 mb-1 mt-1 grid grid-cols-2 gap-0.5 rounded-md bg-foreground/10 p-0.5"
    >
      {TABS.map(({ id, label }) => {
        const selected = id === selectedTab
        return (
          <button
            key={id}
            type="button"
            role="tab"
            id={`sidebar-tab-${id}`}
            aria-selected={selected}
            aria-controls={`sidebar-panel-${id}`}
            data-testid={`sidebar-tab-${id}`}
            onClick={() => useUIStore.getState().setSidebarTab(id)}
            className={cn(
              'h-6 truncate rounded text-xs transition-colors',
              selected
                ? 'bg-background text-foreground shadow-sm dark:bg-foreground/20'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
