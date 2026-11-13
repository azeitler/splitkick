import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useProjects, useCreateFolder } from '@/services/projects'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import { useIsMobile } from '@/hooks/use-mobile'
import { ProjectTree } from './ProjectTree'
import { SidebarArchivedRow } from './SidebarArchivedRow'
import { SidebarScheduledRow } from './SidebarScheduledRow'
import { SidebarHomeRow } from './SidebarHomeRow'
import { SidebarStarredSection } from './SidebarStarredSection'
import { SidebarTodoSection } from './SidebarTodoSection'
import { SidebarGraphsSection } from './SidebarGraphsSection'
import { SidebarRecentSessions } from './SidebarRecentSessions'
import { SidebarTabs } from './SidebarTabs'
import { useInstalledBackends } from '@/hooks/useInstalledBackends'
import { scheduleIdleWork } from '@/lib/idle'
import { useSidebarReveal } from './useSidebarReveal'
import { useSidebarStickyStack } from './useSidebarStickyStack'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { SidebarTab } from '@/types/ui-state'

/** What the tabs other than Projects show. */
const TAB_CONTENT: Record<Exclude<SidebarTab, 'projects'>, ReactNode> = {
  recent: <SidebarRecentSessions />,
  starred: <SidebarStarredSection />,
  todo: <SidebarTodoSection />,
  graphs: <SidebarGraphsSection />,
}

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
      {/* Home sits above the tabs: it is a place, not a list, and stays one
          click away whatever tab is open. */}
      <SidebarHomeRow />
      <SidebarTabs />

      {/* `scrollbar-gutter: stable` keeps a lane for the scrollbar, so the
          thumb never draws over the session timestamps at the right edge and
          the tree does not shift sideways when the list starts to overflow.
          The Projects panel stays mounted, only made invisible, while another
          tab shows: `display: none` would drop its scroll position on a tab
          switch, and a jump from Recent or To-Do reveals its row there. */}
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
          {/* Folders and Projects scroll in one list with a sticky stack: each
              section header stays stuck once you scroll past it, and the
              folder, project and worktree rows stick below them
              (sidebar-sticky.ts). */}
          <div
            ref={scrollRef}
            data-testid="sidebar-projects-scroll"
            data-sidebar-sticky-scroll=""
            className="sidebar-sticky-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-[calc(var(--safe-area-bottom)+1.25rem)] [scrollbar-gutter:stable]"
          >
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
            <SidebarScheduledRow />
            <SidebarArchivedRow />
          </div>
        </div>

        {sidebarTab !== 'projects' && (
          <div
            role="tabpanel"
            id={`sidebar-panel-${sidebarTab}`}
            aria-labelledby={`sidebar-tab-${sidebarTab}`}
            className="absolute inset-0 overflow-y-auto overflow-x-hidden pb-[calc(var(--safe-area-bottom)+1.25rem)] [scrollbar-gutter:stable]"
          >
            {TAB_CONTENT[sidebarTab]}
          </div>
        )}
      </div>
    </div>
  )
}
