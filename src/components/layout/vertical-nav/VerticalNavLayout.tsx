import {
  lazy,
  Suspense,
  useCallback,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import { WindowToolbar } from '@/components/toolbar/WindowToolbar'
import { SidebarFooter } from '@/components/sidebar/SidebarFooter'
import { isNativeApp } from '@/lib/environment'
import { useUIStore } from '@/store/ui-store'
import type { SidebarTab } from '@/types/ui-state'
import { DevModeBanner } from '../DevModeBanner'
import { SidebarWidthProvider } from '../SidebarWidthContext'
import { HomeFooter } from './HomeFooter'
import { openHome, useIsHomeNavActive } from './home-nav'
import {
  NAV_WIDTH_COLLAPSED,
  NAV_WIDTH_EXPANDED,
  VerticalNav,
} from './VerticalNav'

const ProjectsSidebar = lazy(() =>
  import('@/components/projects/ProjectsSidebar').then(mod => ({
    default: mod.ProjectsSidebar,
  }))
)

// Panel width limits, the same as today's sidebar (pixels).
const MIN_PANEL_WIDTH = 150
const MAX_PANEL_WIDTH = 500

interface VerticalNavLayoutProps {
  windowTitle: string
  isInitialized: boolean
  /** The main content row (context panel, main column, browser pane). */
  children: ReactNode
}

/**
 * The desktop layout, with the vertical navigation: the app and web access
 * in a desktop-size browser. Phones have their own tabs (MobileTabShell).
 * Draft and spec: docs/mockups/vertical-nav/.
 *
 * - Other tabs: one sidebar column (in the app an empty title strip for the
 *   window controls, nav + panel, today's footer), the main column with the
 *   sidebar toggle in front of back/forward.
 * - Home: no panel and no sidebar column. The toolbar spans the window, the
 *   nav sits below it, and the footer row holds the compact sidebar footer
 *   and the Home footer. The nav shows also with the sidebar hidden.
 * - Sidebar hidden (other tabs) or zen: the main column only.
 *
 * The main content stays at one place in the tree in every state, so a
 * switch between Home and a tab never remounts it.
 */
export function VerticalNavLayout({
  windowTitle,
  isInitialized,
  children,
}: VerticalNavLayoutProps) {
  const sidebarVisible = useUIStore(state => state.leftSidebarVisible)
  const zenMode = useUIStore(state => state.zenMode)
  const panelSize = useUIStore(state => state.leftSidebarSize)
  const collapsed = useUIStore(state => state.verticalNavCollapsed)
  const homeView = useIsHomeNavActive()

  // A tab picked on Home shows its panel next to the Home view. Reset when
  // Home closes, so the next visit to Home shows Home again.
  const [panelOnHome, setPanelOnHome] = useState(false)
  const [prevHomeView, setPrevHomeView] = useState(homeView)
  if (prevHomeView !== homeView) {
    setPrevHomeView(homeView)
    if (!homeView) setPanelOnHome(false)
  }

  const home = homeView && !panelOnHome && !zenMode
  const navShown = isInitialized && !zenMode && (home || sidebarVisible)
  const sideShown = navShown && !home
  const homeNavShown = navShown && home

  const handleSelectHome = useCallback(() => {
    openHome()
    setPanelOnHome(false)
  }, [])

  const handleSelectTab = useCallback((tab: SidebarTab) => {
    const { setSidebarTab, leftSidebarVisible, setLeftSidebarVisible } =
      useUIStore.getState()
    setSidebarTab(tab)
    if (!leftSidebarVisible) setLeftSidebarVisible(true)
    setPanelOnHome(true)
  }, [])

  // The column holds nav + panel at the expanded nav width; collapsing the
  // nav gives its room to the panel. Drag writes the DOM, mouseup the store.
  const columnRef = useRef<HTMLDivElement>(null)
  const handleResizeStart = useCallback((event: ReactMouseEvent) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = useUIStore.getState().leftSidebarSize
    let currentWidth = startWidth

    const handleMouseMove = (moveEvent: MouseEvent) => {
      currentWidth = Math.min(
        MAX_PANEL_WIDTH,
        Math.max(MIN_PANEL_WIDTH, startWidth + moveEvent.clientX - startX)
      )
      if (columnRef.current) {
        columnRef.current.style.width = `${currentWidth + NAV_WIDTH_EXPANDED}px`
      }
    }
    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      useUIStore.getState().setLeftSidebarSize(currentWidth)
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [])

  const native = isNativeApp()
  const panelWidth =
    panelSize + (collapsed ? NAV_WIDTH_EXPANDED - NAV_WIDTH_COLLAPSED : 0)

  return (
    <div
      className="flex flex-1 overflow-hidden"
      data-testid="vertical-nav-layout"
      data-home={home ? 'true' : 'false'}
    >
      {sideShown && (
        <SidebarWidthProvider value={panelWidth}>
          <div
            ref={columnRef}
            data-testid="sidebar-column"
            className="flex h-full flex-col overflow-hidden bg-sidebar"
            style={{ width: panelSize + NAV_WIDTH_EXPANDED }}
          >
            {/* Only the window controls live here; a browser has none. */}
            {native && (
              <div
                data-tauri-drag-region
                data-testid="vertical-nav-titlebar"
                className="h-[var(--titlebar-height)] shrink-0 border-b border-border/60"
              />
            )}
            <div className="flex min-h-0 flex-1">
              <VerticalNav
                home={false}
                onSelectHome={handleSelectHome}
                onSelectTab={handleSelectTab}
              />
              <div className="min-w-0 flex-1" data-testid="vertical-nav-panel">
                <Suspense fallback={null}>
                  <ProjectsSidebar />
                </Suspense>
              </div>
            </div>
            <SidebarFooter />
          </div>
        </SidebarWidthProvider>
      )}

      {sideShown && (
        <div
          role="separator"
          tabIndex={-1}
          aria-orientation="vertical"
          aria-label="Resize left sidebar"
          className="relative h-full w-px bg-border"
          onMouseDown={handleResizeStart}
        >
          <div className="absolute inset-y-0 -left-1.5 -right-1.5 cursor-col-resize" />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <WindowToolbar
          fallbackTitle={windowTitle}
          trafficLightInset={!sideShown}
          sidebarToggle={!home && !zenMode}
        />
        <DevModeBanner />
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {homeNavShown && (
            <VerticalNav
              home
              onSelectHome={handleSelectHome}
              onSelectTab={handleSelectTab}
            />
          )}
          <div className="flex min-w-0 flex-1 overflow-hidden">{children}</div>
        </div>
        {homeNavShown && (
          <div data-testid="home-footer-row" className="flex shrink-0">
            <div className="shrink-0 border-r border-border bg-sidebar">
              <SidebarFooter compact />
            </div>
            <HomeFooter />
          </div>
        )}
      </div>
    </div>
  )
}
