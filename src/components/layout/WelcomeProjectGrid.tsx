import { useCallback, useMemo, useState } from 'react'
import { ChevronRight, Folder, FolderOpen, Plus } from 'lucide-react'
import { convertFileSrc, convertProjectFileSrc } from '@/lib/transport'
import { isFolder, type Project } from '@/types/projects'
import { useAppDataDir } from '@/services/projects'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { HOME_FILTER_MIN_ITEMS } from '@/components/home/home-utils'
import { HomeSection } from '@/components/home/HomeSection'
import {
  groupProjectsByFolder,
  type ProjectGroup,
} from '@/components/home/project-groups'
import { cn } from '@/lib/utils'

/**
 * The projects section of the Home view, grouped by the sidebar folders.
 *
 * It renders as a section, not as a page: `HomeView` owns the frame, the
 * columns and the scrolling. In a narrow column the grid falls back to one card
 * per row on its own.
 */
interface WelcomeProjectGridProps {
  /** The visible projects and folders, as the Projects tree gets them. */
  projects: Project[]
  onProjectClick: (projectId: string) => void
  onAddProject: () => void
}

/** A project with its avatar. Shared with the phone layout's Home tab. */
export function ProjectCard({
  project,
  appDataDir,
  onClick,
}: {
  project: Project
  appDataDir: string
  onClick: () => void
}) {
  const avatarKey = project.avatar_path ?? project.default_avatar_path ?? null
  const [imgErrorKey, setImgErrorKey] = useState<string | null>(null)
  const imgError = imgErrorKey === avatarKey

  const avatarUrl =
    project.avatar_path && appDataDir && !imgError
      ? convertFileSrc(`${appDataDir}/${project.avatar_path}`)
      : project.default_avatar_path && !imgError
        ? convertProjectFileSrc(project.default_avatar_path)
        : null

  return (
    <button
      type="button"
      onClick={onClick}
      title={project.name}
      className="flex min-w-0 items-center gap-3 rounded-md border bg-muted/30 p-3 text-left transition-colors hover:border-foreground/20 hover:bg-muted/50"
    >
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={project.name}
          className="size-8 shrink-0 rounded-md object-cover"
          onError={() => setImgErrorKey(avatarKey)}
        />
      ) : (
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted-foreground/20">
          <span className="text-sm font-medium uppercase text-muted-foreground">
            {project.name[0]}
          </span>
        </div>
      )}
      <span className="truncate text-sm font-medium">{project.name}</span>
    </button>
  )
}

export function WelcomeProjectGrid({
  projects,
  onProjectClick,
  onAddProject,
}: WelcomeProjectGridProps) {
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const { data: appDataDir = '' } = useAppDataDir()

  const realProjects = useMemo(
    () => projects.filter(p => !isFolder(p)),
    [projects]
  )

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase()
    const all = groupProjectsByFolder(projects)
    if (!q) return all
    return all
      .map(group => ({
        ...group,
        projects: group.projects.filter(p => p.name.toLowerCase().includes(q)),
      }))
      .filter(group => group.projects.length > 0)
  }, [projects, search])

  // With no folders there is nothing to group by: no header over the cards.
  const showHeaders = groups.some(group => group.folder)
  const filtering = search.trim() !== ''

  const toggle = useCallback((id: string) => {
    setCollapsed(current => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }, [])

  return (
    <HomeSection
      title="Projects"
      testId="home-projects"
      action={
        // Stays while it holds a query, so the filter can always be cleared.
        (realProjects.length >= HOME_FILTER_MIN_ITEMS || search !== '') && (
          <Input
            placeholder="Filter projects..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-8 max-w-[12rem]"
          />
        )
      }
    >
      <div className="flex flex-col gap-4">
        {groups.map(group => {
          // A filter shows every match, also in a collapsed folder.
          const open = filtering || !collapsed.has(group.id)
          return (
            <div
              key={group.id}
              data-testid={`home-project-group-${group.id}`}
              className="flex min-w-0 flex-col gap-1.5"
            >
              {showHeaders && (
                <ProjectGroupHeader
                  group={group}
                  open={open}
                  onToggle={filtering ? undefined : () => toggle(group.id)}
                />
              )}
              {open && (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] gap-2">
                  {group.projects.map(project => (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      appDataDir={appDataDir}
                      onClick={() => onProjectClick(project.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {groups.length === 0 && filtering && (
        <p className="text-sm text-muted-foreground">
          No projects match &ldquo;{search.trim()}&rdquo;
        </p>
      )}

      <Button
        variant="outline"
        size="sm"
        onClick={onAddProject}
        className="mt-1 self-start"
      >
        <Plus className="mr-2 h-4 w-4" />
        Add Project
        <Kbd className="ml-2 h-5 px-1.5 text-[10px]">⌘ N</Kbd>
      </Button>
    </HomeSection>
  )
}

/** A folder over its project cards; collapses the group when clicked. */
function ProjectGroupHeader({
  group,
  open,
  onToggle,
}: {
  group: ProjectGroup
  open: boolean
  /** Unset while a filter runs: the group then always shows its matches. */
  onToggle?: () => void
}) {
  const label = group.folder ? group.path.join(' / ') : 'Not in a folder'
  const FolderIcon = open ? FolderOpen : Folder
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={!onToggle}
      aria-expanded={open}
      className="flex h-6 min-w-0 items-center gap-1.5 self-start rounded-sm pr-1 text-xs font-medium text-muted-foreground transition-colors enabled:hover:text-foreground disabled:cursor-default"
    >
      <ChevronRight
        aria-hidden="true"
        className={cn(
          'size-3.5 shrink-0 transition-transform',
          open && 'rotate-90',
          !onToggle && 'opacity-0'
        )}
      />
      {group.folder && (
        <FolderIcon aria-hidden="true" className="size-3.5 shrink-0" />
      )}
      <span className="truncate" title={label}>
        {label}
      </span>
      <span className="shrink-0 tabular-nums text-muted-foreground/70">
        {group.projects.length}
      </span>
    </button>
  )
}
