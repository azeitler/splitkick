import { useMemo, type ReactNode } from 'react'
import { ChevronsLeft, ChevronsRight, House } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  TAB_META,
  useSidebarTabCounts,
} from '@/components/projects/SidebarTabs'
import { cn } from '@/lib/utils'
import { useAgents } from '@/services/agents'
import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'
import { SIDEBAR_TABS, type SidebarTab } from '@/types/ui-state'

/** Nav width with labels, and with icons only (the draft's 168 / 46 px). */
export const NAV_WIDTH_EXPANDED = 168
export const NAV_WIDTH_COLLAPSED = 46

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
        'relative flex h-8 w-full shrink-0 items-center gap-2.5 overflow-hidden whitespace-nowrap rounded-[7px] px-[9px] text-sm transition-colors [&_svg]:size-4 [&_svg]:shrink-0',
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
            'absolute left-[19px] top-[3px] h-[15px] min-w-[15px] rounded-full border-[1.5px] px-1 text-center text-[9px] font-semibold leading-[12px] tabular-nums text-white',
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
 * The vertical navigation (experimental): Home, then the sidebar tabs, and a
 * Collapse / Expand item at the bottom. Collapsed shows icons with tooltips
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
      className="flex h-full shrink-0 flex-col gap-0.5 overflow-hidden border-r border-border bg-sidebar px-1.5 py-2 transition-[width] duration-200 ease-out"
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
      <div aria-hidden="true" className="mx-1 my-1.5 h-px shrink-0 bg-border" />
      {SIDEBAR_TABS.map(tab => {
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
