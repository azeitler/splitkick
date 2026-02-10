import { useEffect, useRef } from 'react'
import { Plus, Folder, Archive, Briefcase } from 'lucide-react'
import { useSidebarWidth } from '@/components/layout/SidebarWidthContext'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useProjects, useCreateFolder } from '@/services/projects'
import { fetchWorktreesStatus } from '@/services/git-status'
import { useProjectsStore } from '@/store/projects-store'
import { ProjectTree } from './ProjectTree'

export function ProjectsSidebar() {
  const { data: projects = [], isLoading } = useProjects()
  const { setAddProjectDialogOpen } = useProjectsStore()
  const createFolder = useCreateFolder()
  const sidebarWidth = useSidebarWidth()

  // Responsive layout threshold
  const isNarrow = sidebarWidth < 180

  // Fetch worktree git status for all projects on startup
  // Priority: expanded projects first, then all others
  // Note: Session prefetching is handled by useSessionPrefetch in MainWindow
  const hasFetchedRef = useRef(false)
  useEffect(() => {
    if (hasFetchedRef.current || projects.length === 0) return
    hasFetchedRef.current = true

    // Filter to only actual projects (not folders)
    const actualProjects = projects.filter(p => !p.is_folder)
    if (actualProjects.length === 0) return

    // Get expanded projects from store (use getState to avoid subscription)
    const { expandedProjectIds } = useProjectsStore.getState()

    // Split into expanded (priority) and collapsed projects
    const expandedProjects = actualProjects.filter(p =>
      expandedProjectIds.has(p.id)
    )
    const collapsedProjects = actualProjects.filter(
      p => !expandedProjectIds.has(p.id)
    )

    // Fetch git status for a batch of projects
    const fetchGitStatusBatch = async (batch: typeof actualProjects) => {
      await Promise.all(
        batch.map(p =>
          fetchWorktreesStatus(p.id).catch(err =>
            console.warn(
              `[startup] Failed to fetch git status for ${p.name}:`,
              err
            )
          )
        )
      )
    }

    const fetchAll = async () => {
      const concurrencyLimit = 3

      console.info(
        '[startup] Fetching worktree git status: expanded=%d, collapsed=%d',
        expandedProjects.length,
        collapsedProjects.length
      )

      // First: fetch expanded projects (user sees these immediately)
      for (let i = 0; i < expandedProjects.length; i += concurrencyLimit) {
        const batch = expandedProjects.slice(i, i + concurrencyLimit)
        await fetchGitStatusBatch(batch)
      }

      // Then: fetch collapsed projects in background (lazy load for when user expands)
      for (let i = 0; i < collapsedProjects.length; i += concurrencyLimit) {
        const batch = collapsedProjects.slice(i, i + concurrencyLimit)
        await fetchGitStatusBatch(batch)
      }

      console.info(
        '[startup] Done fetching worktree git status for all projects'
      )
    }

    fetchAll()
  }, [projects])

  return (
    <div className="flex h-full flex-col">
      {/* Content */}
      <div className="min-h-0 flex-1 overflow-auto">
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

      {/* Footer - transparent buttons with hover background */}
      <div
        className={`flex gap-1 p-1.5 pb-2 ${isNarrow ? 'flex-col' : 'items-center'}`}
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
            <DropdownMenuItem onClick={() => setAddProjectDialogOpen(true)}>
              <Briefcase className="mr-2 size-3.5" />
              Project
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
          onClick={() => window.dispatchEvent(new CustomEvent('command:open-archived-modal'))}
        >
          {!isNarrow && <Archive className="size-3.5" />}
          Archived
        </button>
      </div>

    </div>
  )
}
