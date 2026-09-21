import { useCallback, useEffect, useState } from 'react'
import type { Project } from '@/types/projects'
import { useUIStore } from '@/store/ui-store'
import { MobileHomeTab } from './MobileHomeTab'
import { MobileStarredTab } from './MobileStarredTab'
import { MobileHistoryTab } from './MobileHistoryTab'
import { MobileUsageTab } from './MobileUsageTab'
import { MobileSettingsPage } from './MobileSettingsPage'
import { useRefreshSessionsOnOpen } from '@/components/unread/useRefreshSessionsOnOpen'
import { MobileProjectLayer } from './MobileProjectLayer'
import { MobileTabBar } from './MobileTabBar'

/**
 * The phone layout: four tabs at the root, a project as a modal over them,
 * and a session pushed on top of the project.
 *
 * It replaces the drawer, which put the whole desktop project tree in a panel
 * four levels deep. The stack is not owned here — see `MobileProjectLayer` —
 * so everything that already opens a project or a session keeps working.
 *
 * Only the active tab is mounted. Tabs are cheap to rebuild from the shared
 * all-sessions cache, and a hidden tab would keep its queries and timers alive.
 */
export function MobileTabShell({ projects }: { projects: Project[] }) {
  const activeTab = useUIStore(state => state.mobileActiveTab)
  const initialized = useUIStore(state => state.uiStateInitialized)
  // The desktop unread bell keeps the session list fresh; the phone has no
  // bell, and History and Unread read the same list.
  useRefreshSessionsOnOpen()

  // Projects opened after launch restore rise as modals; the one restore brings
  // back must simply be there.
  const [animate, setAnimate] = useState(false)
  useEffect(() => {
    if (!initialized) return
    const frame = requestAnimationFrame(() => setAnimate(true))
    return () => cancelAnimationFrame(frame)
  }, [initialized])

  // Settings is a page pushed over Home, not a navigation level the rest of
  // the app opens, so it is local state rather than a store field.
  const [settingsOpen, setSettingsOpen] = useState(false)
  const openSettings = useCallback(() => setSettingsOpen(true), [])
  const closeSettings = useCallback(() => setSettingsOpen(false), [])

  return (
    <div
      className="relative flex h-full w-full min-w-0 flex-col overflow-hidden bg-background"
      data-testid="mobile-tab-shell"
    >
      <div role="tabpanel" aria-label={activeTab} className="min-h-0 flex-1">
        {activeTab === 'home' && (
          <MobileHomeTab projects={projects} onOpenSettings={openSettings} />
        )}
        {activeTab === 'starred' && <MobileStarredTab />}
        {activeTab === 'history' && <MobileHistoryTab />}
        {activeTab === 'usage' && <MobileUsageTab />}
      </div>

      <MobileTabBar />
      {/* Before the project layer at the same z, so a project opened from
          search while Settings is up lands on top of it. */}
      {settingsOpen && <MobileSettingsPage onClose={closeSettings} />}
      <MobileProjectLayer animate={animate} />
    </div>
  )
}
