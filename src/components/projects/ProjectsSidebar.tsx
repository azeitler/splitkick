import { useCallback, useEffect, useRef, useState } from 'react'
import { useProjects, useCreateFolder } from '@/services/projects'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import { useIsMobile } from '@/hooks/use-mobile'
import { ProjectTree } from './ProjectTree'
import { SidebarArchivedRow } from './SidebarArchivedRow'
import { SidebarHomeRow } from './SidebarHomeRow'
import { SidebarStarredSection } from './SidebarStarredSection'
import { SidebarRecentSessions } from './SidebarRecentSessions'
import { SidebarTabs } from './SidebarTabs'
import { useInstalledBackends } from '@/hooks/useInstalledBackends'
import { scheduleIdleWork } from '@/lib/idle'
import { useSidebarReveal } from './useSidebarReveal'
import { useSidebarStickyStack } from './useSidebarStickyStack'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function ProjectsSidebar() {
  const {
    data: projectsData,
    isLoading,
    isError: projectsFailed,
    refetch: refetchProjects,
  } = useProjects()
  const projects = projectsData ?? []
  const createFolder = useCreateFolder()
  const sidebarTab = useUIStore(state => state.sidebarTab)
  const isMobile = useIsMobile()
  const [backendCheckReady, setBackendCheckReady] = useState(false)
  useEffect(() => scheduleIdleWork(() => setBackendCheckReady(true), 1500), [])
  const { installedBackends, isUnknown: backendsUnknown } =
    useInstalledBackends({
      enabled: backendCheckReady,
    })
  const setupIncomplete = !backendsUnknown && installedBackends.length === 0

  // Lets a command-palette jump scroll its target row into view.
  const scrollRef = useRef<HTMLDivElement>(null)
  useSidebarReveal(scrollRef)
  useSidebarStickyStack(scrollRef)

  const handleNewFolder = useCallback(() => {
    createFolder.mutate({ name: 'New Folder' })
  }, [createFolder])

  const handleNewProject = useCallback(() => {
    // The dialog would open behind the mobile projects drawer.
    if (isMobile) {
      useUIStore.getState().setLeftSidebarVisible(false)
    }
    useProjectsStore.getState().setAddProjectDialogOpen(true)
  }, [isMobile])

  return (
    <div className="flex h-full flex-col" data-testid="projects-sidebar">
      <SidebarTabs />

      {/* `scrollbar-gutter: stable` keeps a lane for the scrollbar, so the
          thumb never draws over the session timestamps at the right edge and
          the tree does not shift sideways when the list starts to overflow.
          The Projects panel stays mounted, only made invisible, while Recent
          shows: `display: none` would drop its scroll position on a tab
          switch. */}
      <div className="relative min-h-0 flex-1">
        <div
          role="tabpanel"
          id="sidebar-panel-projects"
          aria-labelledby="sidebar-tab-projects"
          aria-hidden={sidebarTab !== 'projects'}
          className={cn(
            'absolute inset-0 flex flex-col',
            sidebarTab !== 'projects' && 'invisible'
          )}
        >
          {/* Home stays put above the list that scrolls. Starred, Folders and
              Projects scroll in one list with a sticky stack: each section
              header stays stuck once you scroll past it, and the folder,
              project and worktree rows stick below them (sidebar-sticky.ts). */}
          <SidebarHomeRow />
          <div
            ref={scrollRef}
            data-testid="sidebar-projects-scroll"
            data-sidebar-sticky-scroll=""
            className="sidebar-sticky-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-[calc(var(--safe-area-bottom)+1.25rem)] [scrollbar-gutter:stable]"
          >
            <SidebarStarredSection />
            {isLoading ? (
              <div className="flex items-center justify-center p-4">
                <span className="text-sm text-muted-foreground">
                  Loading...
                </span>
              </div>
            ) : projectsFailed && projectsData === undefined ? (
              <div className="flex flex-col items-center justify-center gap-2 p-4">
                <span className="text-sm text-muted-foreground">
                  Couldn&apos;t load projects
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetchProjects()}
                >
                  Retry
                </Button>
              </div>
            ) : (
              // Rendered even when empty: its headers hold the "+ New" buttons.
              <ProjectTree
                projects={projects}
                onNewFolder={handleNewFolder}
                onNewProject={handleNewProject}
                newProjectDisabled={!backendCheckReady || setupIncomplete}
              />
            )}
            <SidebarArchivedRow />
          </div>
        </div>

        {sidebarTab === 'recent' && (
          <div
            role="tabpanel"
            id="sidebar-panel-recent"
            aria-labelledby="sidebar-tab-recent"
            className="absolute inset-0 overflow-y-auto overflow-x-hidden pb-[calc(var(--safe-area-bottom)+1.25rem)] [scrollbar-gutter:stable]"
          >
            <SidebarRecentSessions />
          </div>
        )}
      </div>
    </div>
  )
}
