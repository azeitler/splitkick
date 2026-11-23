import { Fragment, useMemo, type ReactNode } from 'react'
import {
  Archive,
  CalendarClock,
  ChevronsLeft,
  ChevronsRight,
  House,
} from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  TAB_META,
  useSidebarTabCounts,
} from '@/components/projects/SidebarTabs'
import { useArchivedCount } from '@/components/archive/useArchivedCount'
import { openArchivedView } from '@/lib/archived-view'
import { openScheduledView } from '@/lib/scheduled-view'
import { cn } from '@/lib/utils'
import { useAgents } from '@/services/agents'
import { useSchedules } from '@/services/schedules'
import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'
import type { SidebarTab } from '@/types/ui-state'

/** Nav width with labels, and with icons only (the draft's 168 / 46 px). */
export const NAV_WIDTH_EXPANDED = 168
export const NAV_WIDTH_COLLAPSED = 46

/** The tabs in nav order, in groups with a divider between them: the
 *  session lists (To-Do ends them), then Agents and Graphs. The tab strip
 *  keeps `SIDEBAR_TABS`. */
const NAV_TAB_GROUPS: SidebarTab[][] = [
  ['projects', 'recent', 'starred', 'todo'],
  ['agents', 'graphs'],
]

function NavDivider() {
  return (
    <div aria-hidden="true" className="mx-1 my-1.5 h-px shrink-0 bg-border" />
  )
}

/** Tabs that show a count, and what the count means. */
const COUNT_TEXT: Partial<Record<SidebarTab, (count: number) => string>> = {
  starred: count => `${count}`,
  agents: count => `${count} running`,
  todo: count => `${count} waiting for you`,
  graphs: count => `${count} ${count === 1 ? 'request' : 'requests'}`,
}

/**
 * Counts for the nav: the tab strip's counts (starred, To-Do, graph
 * requests) and the agents that run now — agents whose session is sending.
 */
function useNavCounts(): Partial<Record<SidebarTab, number>> {
  const tabCounts = useSidebarTabCounts()
  const { data: agents } = useAgents()
  const sending = useChatStore(state => state.sendingSessionIds)
  const agentsRunning = useMemo(
    () =>
      (agents ?? []).filter(
        agent => agent.sessionId !== null && sending[agent.sessionId]
      ).length,
    [agents, sending]
  )
  return { ...tabCounts, agents: agentsRunning }
}

/** Pages in the main area, below the tabs: Scheduled and Archived. Each one
 *  opens like today's sidebar row did; the panel keeps its tab. The sidebar
 *  comes back if it was hidden, so the nav stays in view. */
function openPage(open: () => void): void {
  open()
  const { leftSidebarVisible, setLeftSidebarVisible } = useUIStore.getState()
  if (!leftSidebarVisible) setLeftSidebarVisible(true)
}

const openScheduledPage = () => openPage(openScheduledView)
const openArchivedPage = () => openPage(() => openArchivedView())

interface NavItemProps {
  id: string
  label: string
  icon: ReactNode
  active: boolean
  collapsed: boolean
  onClick: () => void
  count?: number
  countText?: string
  /** Blue: something waits for the user. */
  attention?: boolean
}

function NavItem({
  id,
  label,
  icon,
  active,
  collapsed,
  onClick,
  count = 0,
  countText,
  attention = false,
}: NavItemProps) {
  const hasCount = count > 0 && countText !== undefined
  const description = hasCount ? `${label} · ${countText}` : label
  const button = (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      aria-label={hasCount ? `${label}, ${countText}` : label}
      data-testid={`vertical-nav-${id}`}
      className={cn(
        'relative flex h-8 w-full shrink-0 items-center whitespace-nowrap rounded-[7px] text-sm transition-colors [&_svg]:size-4 [&_svg]:shrink-0',
        // Collapsed: the icon centred in the 33 px the nav has inside its
        // border (46 px less padding and border); 9 px padding would not fit.
        // Not clipped, so the badge may reach past the row (the nav clips).
        collapsed ? 'justify-center px-0' : 'gap-2.5 px-[9px]',
        active
          ? 'bg-background font-medium text-foreground shadow-sm dark:bg-foreground/15'
          : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground'
      )}
    >
      <span aria-hidden="true" className="contents">
        {icon}
      </span>
      {!collapsed && <span className="truncate">{label}</span>}
      {!collapsed && hasCount && (
        <span
          aria-hidden="true"
          data-testid={`vertical-nav-count-${id}`}
          className={cn(
            'ml-auto text-[11px] tabular-nums',
            attention
              ? 'font-semibold text-blue-600 dark:text-blue-400'
              : 'text-muted-foreground'
          )}
        >
          {count}
        </span>
      )}
      {collapsed && hasCount && (
        <span
          aria-hidden="true"
          data-testid={`vertical-nav-badge-${id}`}
          className={cn(
            'absolute left-[calc(50%+2px)] top-[3px] h-[15px] min-w-[15px] rounded-full border-[1.5px] px-1 text-center text-[9px] font-semibold leading-[12px] tabular-nums text-white',
            attention ? 'bg-blue-600' : 'bg-zinc-500',
            active ? 'border-background' : 'border-sidebar'
          )}
        >
          {count}
        </span>
      )}
    </button>
  )
  if (!collapsed) return button
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">{description}</TooltipContent>
    </Tooltip>
  )
}

interface VerticalNavProps {
  /** Home is the selected item (no panel shows). */
  home: boolean
  onSelectHome: () => void
  onSelectTab: (tab: SidebarTab) => void
}

/**
 * The vertical navigation: Home, then the sidebar tabs, the
 * Scheduled and Archived pages, and a Collapse / Expand item at the bottom. Collapsed shows icons with tooltips
 * and count badges; expanded shows the counts at the end of the row.
 */
export function VerticalNav({
  home,
  onSelectHome,
  onSelectTab,
}: VerticalNavProps) {
  const selectedTab = useUIStore(state => state.sidebarTab)
  const collapsed = useUIStore(state => state.verticalNavCollapsed)
  const counts = useNavCounts()
  const scheduledOpen = useUIStore(state => state.scheduledViewOpen)
  // Filtered to one project, the view belongs to that project's row.
  const archivedOpen = useUIStore(
    state => state.archivedViewOpen && state.archivedViewProjectId === null
  )
  const { data: schedules } = useSchedules()
  const activeSchedules = (schedules ?? []).filter(
    schedule => schedule.enabled !== false
  ).length
  const archivedCount = useArchivedCount()

  const toggleCollapsed = () => {
    const { verticalNavCollapsed, setVerticalNavCollapsed } =
      useUIStore.getState()
    setVerticalNavCollapsed(!verticalNavCollapsed)
  }

  return (
    <nav
      aria-label="Sidebar navigation"
      data-testid="vertical-nav"
      data-collapsed={collapsed ? 'true' : 'false'}
      className="flex h-full shrink-0 flex-col gap-0.5 overflow-hidden border-r border-border bg-sidebar px-1.5 py-2 transition-[width] duration-200 ease-out motion-reduce:transition-none"
      style={{ width: collapsed ? NAV_WIDTH_COLLAPSED : NAV_WIDTH_EXPANDED }}
    >
      <NavItem
        id="home"
        label="Home"
        icon={<House />}
        active={home}
        collapsed={collapsed}
        onClick={onSelectHome}
      />
      <NavDivider />
      {NAV_TAB_GROUPS.map((group, index) => (
        <Fragment key={group.join()}>
          {index > 0 && <NavDivider />}
          {group.map(tab => {
            const { label, icon } = TAB_META[tab]
            const count = counts[tab] ?? 0
            return (
              <NavItem
                key={tab}
                id={tab}
                label={label}
                icon={icon}
                active={!home && selectedTab === tab}
                collapsed={collapsed}
                onClick={() => onSelectTab(tab)}
                count={count}
                countText={COUNT_TEXT[tab]?.(count)}
                attention={tab === 'todo'}
              />
            )
          })}
        </Fragment>
      ))}
      <NavDivider />
      <NavItem
        id="scheduled"
        label="Scheduled"
        icon={<CalendarClock />}
        active={scheduledOpen}
        collapsed={collapsed}
        onClick={openScheduledPage}
        count={activeSchedules}
        countText={`${activeSchedules} active`}
      />
      <NavItem
        id="archived"
        label="Archived"
        icon={<Archive />}
        active={archivedOpen}
        collapsed={collapsed}
        onClick={openArchivedPage}
        count={archivedCount}
        countText={`${archivedCount} archived`}
      />
      <div className="flex-1" />
      <NavItem
        id="collapse"
        label={collapsed ? 'Expand' : 'Collapse'}
        icon={collapsed ? <ChevronsRight /> : <ChevronsLeft />}
        active={false}
        collapsed={collapsed}
        onClick={toggleCollapsed}
      />
    </nav>
  )
}
