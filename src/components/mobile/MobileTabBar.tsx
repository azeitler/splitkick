import { useCallback } from 'react'
import { History, House, Search, Star, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import { MOBILE_TABS, type MobileTab } from '@/types/ui-state'
import { usePeakUsage } from '@/components/titlebar/UsagePopover'
import { useUnreadCount } from '@/components/unread/useUnreadCount'
import { UsageTabIcon } from './UsageTabIcon'

const TAB_LABEL: Record<MobileTab, string> = {
  home: 'Home',
  starred: 'Starred',
  history: 'History',
  usage: 'Usage',
}

const TAB_ICON: Record<Exclude<MobileTab, 'usage'>, LucideIcon> = {
  home: House,
  starred: Star,
  history: History,
}

/** The shared glass surface of the tab pill and the search button. */
const FLOATING_SURFACE =
  'pointer-events-auto border border-border/60 bg-background/80 shadow-lg backdrop-blur-xl'

/**
 * The phone layout's navigation: a floating pill of four tabs, and a separate
 * round search button to its right.
 *
 * Search sits apart because it is not a destination — it opens the command
 * palette over whatever is on screen. The swipe-down gesture still opens it
 * too; this is the visible way in.
 *
 * The phone title bar is only a title, so two of its badges moved here: the
 * unread count sits on Home, and plan usage is drawn around the Usage icon.
 */
export function MobileTabBar() {
  const activeTab = useUIStore(state => state.mobileActiveTab)
  const unreadCount = useUnreadCount()
  // Dev builds fetch usage only on demand, as the desktop badge does, so a
  // restart loop does not hit the usage endpoints' rate limits.
  const peak = usePeakUsage(!import.meta.env.DEV || activeTab === 'usage')

  const handleSelect = useCallback((tab: MobileTab) => {
    useUIStore.getState().setMobileActiveTab(tab)
    // A tab is always its root. The project layer covers the bar while it is
    // open, so this only matters if a queued session never opened.
    if (useProjectsStore.getState().selectedProjectId) {
      useProjectsStore.getState().selectProject(null)
      useChatStore.getState().clearActiveWorktree()
    }
  }, [])

  const handleSearch = useCallback(() => {
    useUIStore.getState().setCommandPaletteOpen(true)
  }, [])

  const describe = (tab: MobileTab): string | undefined => {
    if (tab === 'home' && unreadCount > 0) return `Home, ${unreadCount} unread`
    if (tab === 'usage' && peak)
      return `Usage, ${peak.label} ${Math.round(peak.percent)}%`
    return undefined
  }

  return (
    <nav
      aria-label="Main"
      data-testid="mobile-tab-bar"
      // Under the project layer (z-[2]), which covers it while a project is open.
      className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] flex items-center gap-3 px-4 pb-[calc(var(--safe-area-bottom)+0.75rem)]"
    >
      <div
        role="tablist"
        aria-label="Sections"
        className={cn(
          FLOATING_SURFACE,
          'flex h-16 flex-1 items-center gap-1 rounded-full p-1.5'
        )}
      >
        {MOBILE_TABS.map(tab => {
          const selected = tab === activeTab
          const Icon = tab === 'usage' ? null : TAB_ICON[tab]
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-label={describe(tab)}
              data-testid={`mobile-tab-${tab}-button`}
              onClick={() => handleSelect(tab)}
              className={cn(
                'flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-[11px] font-medium transition-colors',
                selected
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground active:bg-muted/60'
              )}
            >
              {Icon ? (
                <span
                  className="relative flex size-6 items-center justify-center"
                  aria-hidden
                >
                  <Icon
                    className={cn(
                      'size-5',
                      selected && tab === 'starred' && 'fill-current'
                    )}
                  />
                  {tab === 'home' && unreadCount > 0 && (
                    <span
                      data-testid="home-unread-badge"
                      className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground ring-2 ring-background"
                    >
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </span>
              ) : (
                <UsageTabIcon peak={peak} />
              )}
              <span className="truncate">{TAB_LABEL[tab]}</span>
            </button>
          )
        })}
      </div>

      <button
        type="button"
        aria-label="Search"
        data-testid="mobile-search-button"
        onClick={handleSearch}
        className={cn(
          FLOATING_SURFACE,
          'flex size-16 shrink-0 items-center justify-center rounded-full text-foreground transition-colors active:bg-muted/60'
        )}
      >
        <Search className="size-6" aria-hidden />
      </button>
    </nav>
  )
}
