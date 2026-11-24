import { Fragment, useMemo, type ReactNode } from 'react'
import { Archive, ChevronsLeft, ChevronsRight, House } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { TAB_META, useSidebarTabCounts } from './tab-meta'
import { useArchivedCount } from '@/components/archive/useArchivedCount'
import { openArchivedView } from '@/lib/archived-view'
import { cn } from '@/lib/utils'
import {
  agentActivity,
  agentActivityText,
} from '@/components/agents/agent-rows'
import { useCanvasStoreState } from '@/components/chat/hooks/useCanvasStoreState'
import { useAgents } from '@/services/agents'
import { useGraphs } from '@/services/graphs'
import { useAllSessions } from '@/services/chat'
import { useSchedules } from '@/services/schedules'
import { useUIStore } from '@/store/ui-store'
import type { SidebarTab } from '@/types/ui-state'

/** Nav width with labels, and with icons only (the draft's 168 / 46 px). */
export const NAV_WIDTH_EXPANDED = 168
export const NAV_WIDTH_COLLAPSED = 46

/** The tabs in nav order, in groups with a divider between them: the
 *  session lists (To-Do ends them), then Agents and Graphs, then Scheduled
 *  (the Archived page follows it). */
const NAV_TAB_GROUPS: SidebarTab[][] = [
  ['projects', 'recent', 'starred', 'todo'],
  ['agents', 'graphs'],
  ['scheduled'],
]

function NavDivider() {
  return (
    <div aria-hidden="true" className="mx-1 my-1.5 h-px shrink-0 bg-border" />
  )
}

/** Tabs that show a count, and what the count means. */
const COUNT_TEXT: Partial<Record<SidebarTab, (count: number) => string>> = {
  starred: count => `${count}`,
  todo: count => `${count} waiting for you`,
}

/** A collapsed badge has room for two digits; larger counts show "99+". */
export function formatBadgeCount(count: number): string {
  return count > 99 ? '99+' : String(count)
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * Counts for the nav: the tab strip's counts (starred, To-Do), and totals for
 * Agents and Graphs. The total of agents / graphs always shows; what needs
 * the user turns the count blue and goes into its text: an agent that waits
 * for an answer, an open graph request. The agent status is the one the
 * Agents tab shows (`agentActivity`).
 */
function useNavCounts(): {
  counts: Partial<Record<SidebarTab, number>>
  texts: Partial<Record<SidebarTab, string>>
  attention: Partial<Record<SidebarTab, boolean>>
} {
  const tabCounts = useSidebarTabCounts()
  const { data: agents } = useAgents()
  const { data: graphs } = useGraphs()
  const { data: schedules } = useSchedules()
  const activeSchedules = (schedules ?? []).filter(
    schedule => schedule.enabled !== false
  ).length
  const hasAgents = (agents?.length ?? 0) > 0
  const { data: allSessions } = useAllSessions(hasAgents)
  const storeState = useCanvasStoreState()
  const activity = useMemo(
    () => agentActivity(agents ?? [], allSessions?.entries ?? [], storeState),
    [agents, allSessions?.entries, storeState]
  )
  const agentCount = agents?.length ?? 0
  const graphCount = graphs?.length ?? 0
  const graphRequests = (graphs ?? []).reduce(
    (sum, graph) => sum + graph.openRequests,
    0
  )
  const agentDetail = agentActivityText(activity)
  return {
    counts: {
      ...tabCounts,
      agents: agentCount,
      graphs: graphCount,
      scheduled: activeSchedules,
    },
    texts: {
      agents: [plural(agentCount, 'agent'), agentDetail]
        .filter(Boolean)
        .join(', '),
      graphs: [
        plural(graphCount, 'graph'),
        graphRequests > 0 ? plural(graphRequests, 'open request') : null,
      ]
        .filter(Boolean)
        .join(', '),
      scheduled: `${activeSchedules} active`,
    },
    attention: {
      todo: true,
      agents: activity.waiting > 0,
      graphs: graphRequests > 0,
    },
  }
}

/** The Archived page, below the tabs: it opens in the main area, and no
 *  tab item is active while it shows. The sidebar comes back if it was
 *  hidden, so the nav stays in view. */
function openArchivedPage(): void {
  openArchivedView()
  const { leftSidebarVisible, setLeftSidebarVisible } = useUIStore.getState()
  if (!leftSidebarVisible) setLeftSidebarVisible(true)
}

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
            // Flex centering: a line-height alone sat the digits off-centre.
            'absolute left-[calc(50%+2px)] top-[3px] inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-full border-[1.5px] px-[3px] text-[9px] font-semibold leading-none tabular-nums text-white',
            attention ? 'bg-blue-600' : 'bg-zinc-500',
            active ? 'border-background' : 'border-sidebar'
          )}
        >
          {formatBadgeCount(count)}
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
 * The vertical navigation: Home, then the sidebar tabs (Scheduled is the
 * last), the Archived page, and a Collapse / Expand item at the bottom. Collapsed shows icons with tooltips
 * and count badges; expanded shows the counts at the end of the row.
 */
export function VerticalNav({
  home,
  onSelectHome,
  onSelectTab,
}: VerticalNavProps) {
  const selectedTab = useUIStore(state => state.sidebarTab)
  const collapsed = useUIStore(state => state.verticalNavCollapsed)
  const { counts, texts, attention } = useNavCounts()
  // Filtered to one project, the view belongs to that project's row (in
  // the Projects tab, which then stays active).
  const archivedOpen = useUIStore(
    state => state.archivedViewOpen && state.archivedViewProjectId === null
  )
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
      className="flex h-full shrink-0 flex-col gap-0.5 overflow-hidden border-r border-border bg-sidebar px-1.5 py-2"
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
                active={!home && !archivedOpen && selectedTab === tab}
                collapsed={collapsed}
                onClick={() => onSelectTab(tab)}
                count={count}
                countText={texts[tab] ?? COUNT_TEXT[tab]?.(count)}
                attention={attention[tab] ?? false}
              />
            )
          })}
        </Fragment>
      ))}
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
