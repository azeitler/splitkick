import { memo, useCallback, useMemo, useState } from 'react'
import { Archive, MessagesSquare, Plus, Settings } from 'lucide-react'
import type { Project } from '@/types/projects'
import type { MobileHomeSegment } from '@/types/ui-state'
import { cn } from '@/lib/utils'
import { useAllSessions } from '@/services/chat'
import { useAppDataDir } from '@/services/projects'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import { useCanvasStoreState } from '@/components/chat/hooks/useCanvasStoreState'
import { ProjectCard } from '@/components/layout/WelcomeProjectGrid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  flattenAllSessions,
  HOME_FILTER_MIN_ITEMS,
  matchesSessionQuery,
  resolveSessionLabel,
} from '@/components/home/home-utils'
import {
  groupProjectsByFolder,
  openProjectFromTab,
  recentlyOpenedSessions,
  unreadSessions,
  useHasPendingUpdate,
} from './mobile-nav-utils'
import {
  MobileEmptyState,
  MobileSessionList,
  MobileTabPage,
  MobileTabSection,
} from './MobileTabPage'

const SEGMENTS: { id: MobileHomeSegment; label: string }[] = [
  { id: 'sessions', label: 'Sessions' },
  { id: 'projects', label: 'Projects' },
]

/**
 * The Home tab: where you left off first, then a switch between sessions and
 * projects.
 *
 * Continue stays above the switch, so the one session you most likely want is
 * one tap away whichever list is shown. Starred and History have tabs of their
 * own. Unread holds what the desktop's title-bar bell lists.
 */
export const MobileHomeTab = memo(function MobileHomeTab({
  projects,
  onOpenSettings,
}: {
  /** Every entry of the projects list, folders included. */
  projects: Project[]
  /** Push the Settings page over Home. */
  onOpenSettings: () => void
}) {
  const updateAvailable = useHasPendingUpdate()
  const segment = useUIStore(state => state.mobileHomeSegment)
  const { data } = useAllSessions()
  const storeState = useCanvasStoreState()

  const continueRow = useMemo(
    () => recentlyOpenedSessions(data?.entries ?? [])[0],
    [data?.entries]
  )

  return (
    <MobileTabPage
      title="Home"
      testId="mobile-tab-home"
      action={
        // Settings lives here, top right: a phone has no title bar. The dot
        // marks a pending app, server or CLI update, which Settings lists.
        <Button
          variant="ghost"
          size="icon"
          className="relative -mr-2 size-11 shrink-0 text-muted-foreground"
          aria-label={
            updateAvailable ? 'Settings, update available' : 'Settings'
          }
          data-testid="mobile-home-settings"
          onClick={onOpenSettings}
        >
          <Settings className="size-6" />
          {updateAvailable && (
            <span
              data-testid="settings-update-dot"
              className="absolute right-2 top-2 size-2.5 rounded-full bg-primary ring-2 ring-background"
            />
          )}
        </Button>
      }
    >
      {continueRow && (
        <MobileTabSection title="Continue">
          <MobileSessionList
            rows={[continueRow]}
            storeState={storeState}
            testId="mobile-home-continue"
          />
        </MobileTabSection>
      )}

      <div
        role="tablist"
        aria-label="Home"
        data-testid="mobile-home-segments"
        className="grid grid-cols-2 gap-1 rounded-full bg-muted p-1"
      >
        {SEGMENTS.map(({ id, label }) => {
          const selected = id === segment
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={selected}
              data-testid={`mobile-home-segment-${id}`}
              onClick={() => useUIStore.getState().setMobileHomeSegment(id)}
              className={cn(
                'h-10 rounded-full text-sm font-medium transition-colors',
                selected
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground active:bg-background/60'
              )}
            >
              {label}
            </button>
          )
        })}
      </div>

      {segment === 'sessions' ? (
        <HomeSessions
          excludeSessionId={continueRow?.session.id}
          storeState={storeState}
        />
      ) : (
        <HomeProjects projects={projects} />
      )}
    </MobileTabPage>
  )
})

/**
 * Unread first, then every other session by latest activity. Recent leaves
 * out the rows Unread and Continue already show. Unread itself stays complete,
 * even when the Continue session is unread too, so it always matches the
 * count on the Home tab icon.
 */
function HomeSessions({
  excludeSessionId,
  storeState,
}: {
  excludeSessionId: string | undefined
  storeState: ReturnType<typeof useCanvasStoreState>
}) {
  const { data, isLoading } = useAllSessions()
  const [query, setQuery] = useState('')

  const unread = useMemo(
    () => unreadSessions(data?.entries ?? []),
    [data?.entries]
  )

  const recent = useMemo(() => {
    const shown = new Set(unread.map(row => row.session.id))
    if (excludeSessionId) shown.add(excludeSessionId)
    return flattenAllSessions(data?.entries ?? []).filter(
      row => !shown.has(row.session.id)
    )
  }, [data?.entries, unread, excludeSessionId])

  const visible = useMemo(
    () =>
      recent.filter(row =>
        matchesSessionQuery(
          row,
          query,
          resolveSessionLabel(row.session, storeState.sessionLabels)
        )
      ),
    [recent, query, storeState.sessionLabels]
  )

  if (isLoading && recent.length === 0 && unread.length === 0) {
    return (
      <p className="px-1 text-sm text-muted-foreground">Loading sessions…</p>
    )
  }

  if (recent.length === 0 && unread.length === 0) {
    return (
      <MobileEmptyState icon={MessagesSquare} title="No other sessions">
        Open a project to start one.
      </MobileEmptyState>
    )
  }

  // The field stays while it holds a query, so a filter can always be cleared.
  const showFilter = recent.length >= HOME_FILTER_MIN_ITEMS || query !== ''

  return (
    <>
      {unread.length > 0 && (
        <MobileTabSection title="Unread">
          <MobileSessionList
            rows={unread}
            storeState={storeState}
            testId="mobile-home-unread"
          />
        </MobileTabSection>
      )}

      {recent.length > 0 && (
        <MobileTabSection title="Recent">
          {showFilter && (
            <Input
              type="search"
              placeholder="Filter sessions..."
              value={query}
              onChange={event => setQuery(event.target.value)}
              className="h-11"
              aria-label="Filter sessions"
            />
          )}
          {visible.length > 0 ? (
            <MobileSessionList
              rows={visible}
              storeState={storeState}
              testId="mobile-home-recent"
            />
          ) : (
            <p className="px-1 text-sm text-muted-foreground">
              No sessions match &ldquo;{query.trim()}&rdquo;
            </p>
          )}
        </MobileTabSection>
      )}
    </>
  )
}

/** Every project, grouped by folder, then Add project and Archived. */
function HomeProjects({ projects }: { projects: Project[] }) {
  const { data: appDataDir = '' } = useAppDataDir()
  const [query, setQuery] = useState('')

  const projectCount = useMemo(
    () =>
      groupProjectsByFolder(projects).reduce(
        (n, g) => n + g.projects.length,
        0
      ),
    [projects]
  )

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const all = groupProjectsByFolder(projects)
    if (!needle) return all
    return all
      .map(group => ({
        ...group,
        projects: group.projects.filter(project =>
          project.name.toLowerCase().includes(needle)
        ),
      }))
      .filter(group => group.projects.length > 0)
  }, [projects, query])

  const handleAddProject = useCallback(() => {
    useProjectsStore.getState().setAddProjectDialogOpen(true)
  }, [])

  const handleOpenArchived = useCallback(() => {
    window.dispatchEvent(new CustomEvent('command:open-archived-modal'))
  }, [])

  const showFilter = projectCount >= HOME_FILTER_MIN_ITEMS || query !== ''

  return (
    <>
      {showFilter && (
        <Input
          type="search"
          placeholder="Filter projects..."
          value={query}
          onChange={event => setQuery(event.target.value)}
          className="h-11"
          aria-label="Filter projects"
        />
      )}
      <div className="flex flex-col gap-5" data-testid="mobile-home-projects">
        {groups.map(group => (
          <div key={group.id} className="flex flex-col gap-2">
            {group.title && (
              <h3 className="truncate px-1 text-sm font-medium text-muted-foreground">
                {group.title}
              </h3>
            )}
            <div className="flex flex-col gap-2">
              {group.projects.map(project => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  appDataDir={appDataDir}
                  onClick={() => openProjectFromTab(project.id)}
                />
              ))}
            </div>
          </div>
        ))}
        {groups.length === 0 && query.trim() && (
          <p className="px-1 text-sm text-muted-foreground">
            No projects match &ldquo;{query.trim()}&rdquo;
          </p>
        )}
      </div>

      {/* The drawer footer's actions. Folder management stays on the desktop. */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          className="h-11 flex-1"
          onClick={handleAddProject}
        >
          <Plus className="size-4" />
          Add project
        </Button>
        <Button
          variant="outline"
          className="h-11 flex-1"
          onClick={handleOpenArchived}
        >
          <Archive className="size-4" />
          Archived
        </Button>
      </div>
    </>
  )
}
