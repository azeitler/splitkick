import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useProjects, useCreateFolder } from '@/services/projects'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import { ProjectTree } from './ProjectTree'
import { ProjectsPanelToolbar } from './ProjectsPanelToolbar'
import { SidebarTabEmpty } from './SidebarTabEmpty'
import { SidebarStarredSection } from './SidebarStarredSection'
import { SidebarAgentsSection } from './SidebarAgentsSection'
import { SidebarTodoSection } from './SidebarTodoSection'
import { SidebarGraphsSection } from './SidebarGraphsSection'
import { SidebarScheduledSection } from './SidebarScheduledSection'
import { SidebarRecentSessions } from './SidebarRecentSessions'
import { useInstalledBackends } from '@/hooks/useInstalledBackends'
import { scheduleIdleWork } from '@/lib/idle'
import { useSidebarReveal } from './useSidebarReveal'
import { useSidebarStickyStack } from './useSidebarStickyStack'
import { Button } from '@/components/ui/button'
import { FolderOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TAB_META } from '@/components/layout/vertical-nav/tab-meta'
import { isVisibleProject } from '@/types/projects'
import type { SidebarTab } from '@/types/ui-state'

/** What the tabs other than Projects show. */
const TAB_CONTENT: Record<Exclude<SidebarTab, 'projects'>, ReactNode> = {
  recent: <SidebarRecentSessions />,
  starred: <SidebarStarredSection />,
  agents: <SidebarAgentsSection />,
  todo: <SidebarTodoSection />,
  graphs: <SidebarGraphsSection />,
  scheduled: <SidebarScheduledSection />,
}

/**
 * The panel next to the vertical navigation: the list of the selected tab.
 * Home, the tabs and Archived are items of the navigation.
 */
export function ProjectsSidebar() {
  const {
    data: projectsData,
    isLoading,
    isError: projectsFailed,
    refetch: refetchProjects,
  } = useProjects()
  // The homes of global agents show in the Agents tab only.
  const projects = useMemo(
    () => (projectsData ?? []).filter(isVisibleProject),
    [projectsData]
  )
  const createFolder = useCreateFolder()
  const sidebarTab = useUIStore(state => state.sidebarTab)
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
    useProjectsStore.getState().setAddProjectDialogOpen(true)
  }, [])

  return (
    <div className="flex h-full flex-col" data-testid="projects-sidebar">
      {/* `scrollbar-gutter: stable` keeps a lane for the scrollbar, so the
          thumb never draws over the session timestamps at the right edge and
          the tree does not shift sideways when the list starts to overflow.
          The Projects panel stays mounted, only made invisible, while another
          tab shows: `display: none` would drop its scroll position on a tab
          switch, and a jump from Recent or To-Do reveals its row there. */}
      <div className="relative min-h-0 flex-1">
        <div
          role="region"
          id="sidebar-panel-projects"
          aria-label={TAB_META.projects.label}
          aria-hidden={sidebarTab !== 'projects'}
          className={cn(
            'absolute inset-0 flex flex-col',
            sidebarTab !== 'projects' && 'invisible'
          )}
        >
          {/* The tree has no root header rows; its actions live here. */}
          <ProjectsPanelToolbar
            projects={projects}
            onNewFolder={handleNewFolder}
            onNewProject={handleNewProject}
            newProjectDisabled={!backendCheckReady || setupIncomplete}
          />
          {/* Folders and projects scroll in one list with a sticky stack: the
              folder, project and worktree rows stick at the top
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
            ) : projects.length === 0 ? (
              <SidebarTabEmpty
                testId="projects-tree-empty"
                icon={<FolderOpen />}
                title="No projects yet"
                hint="Add one with the + button above."
              />
            ) : (
              <ProjectTree projects={projects} />
            )}
          </div>
        </div>

        {sidebarTab !== 'projects' && (
          <div
            role="region"
            id={`sidebar-panel-${sidebarTab}`}
            aria-label={TAB_META[sidebarTab].label}
            className="absolute inset-0 overflow-y-auto overflow-x-hidden pb-[calc(var(--safe-area-bottom)+1.25rem)] [scrollbar-gutter:stable]"
          >
            {TAB_CONTENT[sidebarTab]}
          </div>
        )}
      </div>
    </div>
  )
}
