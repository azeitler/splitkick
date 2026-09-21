import { memo, useCallback, useMemo, useState } from 'react'
import { Archive, Plus, Settings } from 'lucide-react'
import type { Project } from '@/types/projects'
import { useAllSessions } from '@/services/chat'
import { useAppDataDir } from '@/services/projects'
import { useProjectsStore } from '@/store/projects-store'
import { useCanvasStoreState } from '@/components/chat/hooks/useCanvasStoreState'
import { ProjectCard } from '@/components/layout/WelcomeProjectGrid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { HOME_FILTER_MIN_ITEMS } from '@/components/home/home-utils'
import {
  groupProjectsByFolder,
  openProjectFromTab,
  recentlyOpenedSessions,
  unreadSessions,
  useHasPendingUpdate,
} from './mobile-nav-utils'
import {
  MobileSessionList,
  MobileTabPage,
  MobileTabSection,
} from './MobileTabPage'

/**
 * The Home tab: what needs you, where you left off, then every project.
 *
 * Starred and History have tabs of their own, so Home no longer stacks four
 * sections a phone has to scroll past to reach its projects. Unread holds what
 * the desktop's title-bar bell lists; the phone title bar is only a title.
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
  const { data } = useAllSessions()
  const storeState = useCanvasStoreState()
  const { data: appDataDir = '' } = useAppDataDir()
  const [query, setQuery] = useState('')

  const continueRow = useMemo(
    () => recentlyOpenedSessions(data?.entries ?? [])[0],
    [data?.entries]
  )
  const unread = useMemo(
    () => unreadSessions(data?.entries ?? []),
    [data?.entries]
  )

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
    <MobileTabPage
      title="Home"
      testId="mobile-tab-home"
      action={
        // Settings lives here, top right, now that the phone title bar is only
        // a title. The dot marks a pending app, server or CLI update, which the
        // Settings page lists.
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
      {unread.length > 0 && (
        <MobileTabSection title="Unread">
          <MobileSessionList
            rows={unread}
            storeState={storeState}
            testId="mobile-home-unread"
          />
        </MobileTabSection>
      )}

      {continueRow && (
        <MobileTabSection title="Continue">
          <MobileSessionList
            rows={[continueRow]}
            storeState={storeState}
            testId="mobile-home-continue"
          />
        </MobileTabSection>
      )}

      <MobileTabSection title="Projects">
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
      </MobileTabSection>

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
    </MobileTabPage>
  )
})
