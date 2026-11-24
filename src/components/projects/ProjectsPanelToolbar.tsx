import { useMemo } from 'react'
import {
  Briefcase,
  ChevronsDownUp,
  ChevronsUpDown,
  FolderPlus,
  Plus,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useProjectsStore } from '@/store/projects-store'
import { isFolder, type Project } from '@/types/projects'

const ICON_BUTTON =
  'flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent-foreground/10 hover:text-foreground'

interface ProjectsPanelToolbarProps {
  projects: Project[]
  onNewFolder: () => void
  onNewProject: () => void
  newProjectDisabled?: boolean
}

/**
 * The actions of the Projects panel, above its tree: expand or collapse every
 * folder and project, and the "+" menu with New project and New folder. The
 * tree root itself has no header rows.
 */
export function ProjectsPanelToolbar({
  projects,
  onNewFolder,
  onNewProject,
  newProjectDisabled,
}: ProjectsPanelToolbarProps) {
  const expandedFolderIds = useProjectsStore(state => state.expandedFolderIds)
  const expandedProjectIds = useProjectsStore(state => state.expandedProjectIds)

  const { folderIds, projectIds } = useMemo(
    () => ({
      folderIds: projects.filter(isFolder).map(p => p.id),
      projectIds: projects.filter(p => !isFolder(p)).map(p => p.id),
    }),
    [projects]
  )

  // Offer the action that changes something: collapse while anything is open.
  const anyExpanded =
    folderIds.some(id => expandedFolderIds.has(id)) ||
    projectIds.some(id => expandedProjectIds.has(id))
  const toggleLabel = anyExpanded ? 'Collapse all' : 'Expand all'
  const ToggleIcon = anyExpanded ? ChevronsDownUp : ChevronsUpDown

  const handleToggle = () => {
    const store = useProjectsStore.getState()
    if (anyExpanded) {
      store.collapseAllFolders()
      store.collapseAllProjects()
    } else {
      store.expandAllFolders(folderIds)
      store.expandAllProjects(projectIds)
    }
  }

  return (
    <div
      data-testid="projects-panel-toolbar"
      className="flex h-8 shrink-0 items-center justify-end gap-0.5 px-2"
    >
      {projects.length > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={ICON_BUTTON}
              onClick={handleToggle}
              aria-label={toggleLabel}
            >
              <ToggleIcon className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{toggleLabel}</TooltipContent>
        </Tooltip>
      )}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={ICON_BUTTON}
                aria-label="New project or folder"
              >
                <Plus className="size-4" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>New project or folder</TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={onNewProject}
            disabled={newProjectDisabled}
          >
            <Briefcase />
            New project
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onNewFolder}>
            <FolderPlus />
            New folder
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
