import { useMemo, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { Clock, FolderTree, ListTodo, Star, Workflow } from 'lucide-react'
import {
  resolveStarredSessions,
  resolveTodoSessions,
} from '@/components/home/home-utils'
import { useSidebarWidth } from '@/components/layout/SidebarWidthContext'
import { cn } from '@/lib/utils'
import { useAllSessions } from '@/services/chat'
import { useGraphs } from '@/services/graphs'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import { SIDEBAR_TABS, type SidebarTab } from '@/types/ui-state'

const TAB_META: Record<SidebarTab, { label: string; icon: ReactNode }> = {
  projects: { label: 'Projects', icon: <FolderTree /> },
  recent: { label: 'Recent', icon: <Clock /> },
  starred: { label: 'Starred', icon: <Star /> },
  todo: { label: 'To-Do', icon: <ListTodo /> },
  graphs: { label: 'Graphs', icon: <Workflow /> },
}

/** From this sidebar width on, every tab shows its label, not only the
 *  selected one. Below it the others are icons with a tooltip. */
export const SIDEBAR_TABS_ALL_LABELS_WIDTH = 400
/** Below this width the selected tab is an icon too. */
export const SIDEBAR_TABS_ICONS_ONLY_WIDTH = 200

/**
 * Counts in the tab labels: starred and To-Do sessions, and graph requests
 * that wait for the user. Same caches the tab contents read, so no new query.
 */
function useSidebarTabCounts(): Partial<Record<SidebarTab, number>> {
  const stars = useProjectsStore(state => state.starredSessions)
  const { data } = useAllSessions()
  const { data: graphs } = useGraphs()

  return useMemo(() => {
    const entries = data?.entries ?? []
    return {
      starred: resolveStarredSessions(stars, entries).length,
      todo: resolveTodoSessions(entries).length,
      graphs: (graphs ?? []).reduce((sum, g) => sum + g.openRequests, 0),
    }
  }, [stars, data?.entries, graphs])
}

/**
 * The tab bar at the top of the sidebar, below the Home row: Projects,
 * Recent, Starred, To-Do and Graphs.
 *
 * A WAI-ARIA tablist with automatic activation: the arrow keys (and Home /
 * End) move the focus and select the tab. The choice is persisted with the
 * rest of the UI state. Five labels do not fit a default-width sidebar, so
 * only the selected tab shows its label until the sidebar is wide.
 */
export function SidebarTabs() {
  const selectedTab = useUIStore(state => state.sidebarTab)
  const width = useSidebarWidth()
  const counts = useSidebarTabCounts()
  const listRef = useRef<HTMLDivElement>(null)

  const select = (tab: SidebarTab) => useUIStore.getState().setSidebarTab(tab)

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = SIDEBAR_TABS.indexOf(selectedTab)
    const last = SIDEBAR_TABS.length - 1
    const next =
      event.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null
    if (next === null) return
    event.preventDefault()
    const tab: SidebarTab = SIDEBAR_TABS[next] ?? 'projects'
    select(tab)
    listRef.current
      ?.querySelector<HTMLButtonElement>(`#sidebar-tab-${tab}`)
      ?.focus()
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="Sidebar"
      data-testid="sidebar-tabs"
      onKeyDown={handleKeyDown}
      // A macOS segmented control: a faint track, the selected segment raised
      // (white in light mode, lighter gray in dark). Tokens relative to the
      // foreground, so the track stays visible on any sidebar color.
      className="mx-2 mb-1 mt-1 flex shrink-0 gap-0.5 rounded-md bg-foreground/10 p-0.5"
    >
      {SIDEBAR_TABS.map(id => {
        const { label, icon } = TAB_META[id]
        const selected = id === selectedTab
        const count = counts[id] ?? 0
        const showLabel =
          width >= SIDEBAR_TABS_ALL_LABELS_WIDTH ||
          (selected && width >= SIDEBAR_TABS_ICONS_ONLY_WIDTH)
        return (
          <button
            key={id}
            type="button"
            role="tab"
            id={`sidebar-tab-${id}`}
            aria-selected={selected}
            aria-controls={`sidebar-panel-${id}`}
            aria-label={
              count === 0
                ? label
                : id === 'graphs'
                  ? `${label}, ${count} waiting for you`
                  : `${label} ${count}`
            }
            title={showLabel ? undefined : label}
            tabIndex={selected ? 0 : -1}
            data-testid={`sidebar-tab-${id}`}
            onClick={() => select(id)}
            className={cn(
              'flex h-6 min-w-0 items-center justify-center gap-1 rounded px-1 text-xs transition-colors [&_svg]:size-3.5 [&_svg]:shrink-0',
              // The selected tab takes the room its label needs.
              showLabel ? 'flex-[2_1_auto]' : 'flex-1',
              selected
                ? 'bg-background text-foreground shadow-sm dark:bg-foreground/20'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <span aria-hidden="true" className="contents">
              {icon}
            </span>
            {showLabel && <span className="truncate">{label}</span>}
            {count > 0 && (
              <span
                aria-hidden="true"
                data-testid={`sidebar-tab-count-${id}`}
                className={cn(
                  'text-[10px] tabular-nums',
                  id === 'graphs'
                    ? 'font-medium text-orange-500'
                    : 'text-muted-foreground'
                )}
              >
                {count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
