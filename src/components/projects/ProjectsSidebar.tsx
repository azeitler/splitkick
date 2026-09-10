import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, Folder, Archive, Briefcase } from 'lucide-react'
import { useSidebarWidth } from '@/components/layout/SidebarWidthContext'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useProjects, useCreateFolder } from '@/services/projects'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import { useIsMobile } from '@/hooks/use-mobile'
import { ProjectTree } from './ProjectTree'
import { SidebarHomeRow } from './SidebarHomeRow'
import { SidebarStarredSection } from './SidebarStarredSection'
import { useInstalledBackends } from '@/hooks/useInstalledBackends'
import { scheduleIdleWork } from '@/lib/idle'
import { useSidebarReveal } from './useSidebarReveal'

/** Close the mobile projects drawer when leaving into a dialog/modal. */
function closeMobileSidebarIfNeeded(isMobile: boolean) {
  if (isMobile) {
    useUIStore.getState().setLeftSidebarVisible(false)
  }
}

export function ProjectsSidebar() {
  const { data: projects = [], isLoading } = useProjects()
  const { setAddProjectDialogOpen } = useProjectsStore()
  const createFolder = useCreateFolder()
  const sidebarWidth = useSidebarWidth()
  const isMobile = useIsMobile()
  const [backendCheckReady, setBackendCheckReady] = useState(false)
  useEffect(() => scheduleIdleWork(() => setBackendCheckReady(true), 1500), [])
  const { installedBackends } = useInstalledBackends({
    enabled: backendCheckReady,
  })
  const setupIncomplete = installedBackends.length === 0

  // Lets a command-palette jump scroll its target row into view.
  const scrollRef = useRef<HTMLDivElement>(null)
  useSidebarReveal(scrollRef)

  // Responsive layout threshold
  const isNarrow = sidebarWidth < 180

  const handleNewProject = useCallback(() => {
    closeMobileSidebarIfNeeded(isMobile)
    setAddProjectDialogOpen(true)
  }, [isMobile, setAddProjectDialogOpen])

  const handleOpenArchived = useCallback(() => {
    closeMobileSidebarIfNeeded(isMobile)
    window.dispatchEvent(new CustomEvent('command:open-archived-modal'))
  }, [isMobile])

  return (
    <div className="flex h-full flex-col" data-testid="projects-sidebar">
      {/* Content */}
      {/* `scrollbar-gutter: stable` keeps a lane for the scrollbar, so the
          thumb never draws over the session timestamps at the right edge and
          the tree does not shift sideways when the list starts to overflow.
          `scroll-pt-9` clears the sticky Home row, so a row revealed from
          above lands below it instead of under it. */}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 scroll-pt-9 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]"
      >
        {/* Home sticks to the top while the tree scrolls, so it is one click
            away from anywhere in a long sidebar. */}
        <SidebarHomeRow />
        <SidebarStarredSection />

        {isLoading ? (
          <div className="flex items-center justify-center p-4">
            <span className="text-sm text-muted-foreground">Loading...</span>
          </div>
        ) : projects.length === 0 ? (
          <div className="flex h-full items-center justify-center px-2">
            <span className="truncate text-sm text-muted-foreground/50">
              No projects found
            </span>
          </div>
        ) : (
          <ProjectTree projects={projects} />
        )}
      </div>

      {/* Footer - transparent buttons with hover background.
          Extra bottom padding (plus safe-area) lifts controls off the screen edge. */}
      <div
        className={`flex gap-1 p-1.5 pb-[calc(var(--safe-area-bottom)+1.25rem)] ${isNarrow ? 'flex-col' : 'items-center'}`}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
            >
              {!isNarrow && <Plus className="size-3.5" />}
              New
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            style={{ width: sidebarWidth - 12 }}
          >
            <DropdownMenuItem
              onClick={() => createFolder.mutate({ name: 'New Folder' })}
            >
              <Folder className="mr-2 size-3.5" />
              Folder
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={handleNewProject}
              disabled={!backendCheckReady || setupIncomplete}
            >
              <Briefcase className="mr-2 size-3.5" />
              Project
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
          onClick={handleOpenArchived}
        >
          {!isNarrow && <Archive className="size-3.5" />}
          Archived
        </button>
      </div>
    </div>
  )
}
