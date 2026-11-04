import { useCallback, useMemo, useState } from 'react'
import { AlertTriangle, FileText, FolderOpen, GitBranch } from 'lucide-react'
import { DirectoryBrowser } from '@/components/projects/DirectoryBrowser'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { isLocalBackend } from '@/lib/environment'
import { openGraphView } from '@/lib/graph-view'
import { cn } from '@/lib/utils'
import {
  useCreateGraph,
  useGraphLocationInfo,
  useOpenGraphFile,
} from '@/services/graphs'
import { useProjects } from '@/services/projects'
import { isFolder } from '@/types/projects'
import { joinPath, slugify, tildePath } from './graph-utils'

export const GRAPH_TYPE_SUGGESTIONS = ['roadmap', 'release', 'research', 'docs']

export type GraphLocationChoice = 'project' | 'repo' | 'folder'

/**
 * The absolute file path a New graph form describes, or null while it is
 * incomplete. `base` is the project path (project) or the picked folder
 * (repo, folder); `relative` is the path inside it.
 */
export function composeGraphPath(
  base: string | null | undefined,
  relative: string
): string | null {
  const rel = relative.trim()
  if (!base || !rel) return null
  return joinPath(base, rel)
}

/** Default path of a new graph file inside a repo. */
export function defaultRepoGraphPath(title: string): string {
  return `.splitkick/graphs/${slugify(title)}.yml`
}

const LOCATION_OPTIONS: {
  value: GraphLocationChoice
  label: string
  description: string
}[] = [
  {
    value: 'project',
    label: "Inside a project's repo",
    description:
      'Versioned and shared with the project. The file follows the branch the base checkout is on.',
  },
  {
    value: 'repo',
    label: 'In another repo',
    description:
      'For example a repo only for graphs. It stays on its default branch.',
  },
  {
    value: 'folder',
    label: 'In a folder outside any repo',
    description:
      'For example ~/Graphs or iCloud Drive. No git: not versioned, sync it yourself.',
  },
]

interface NewGraphDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * New graph: title, type and where the YAML file goes (inside a project's
 * repo, another repo, or a plain folder). The footer opens an existing file.
 */
export function NewGraphDialog({ open, onOpenChange }: NewGraphDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl" data-testid="new-graph-dialog">
        {/* Remount per open, so every New starts from a clean form. */}
        {open && <NewGraphForm onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function NewGraphForm({ onDone }: { onDone: () => void }) {
  const { data: allProjects } = useProjects()
  const projects = useMemo(
    () => (allProjects ?? []).filter(p => !isFolder(p) && p.path),
    [allProjects]
  )

  const [title, setTitle] = useState('')
  const [graphType, setGraphType] = useState('roadmap')
  const [location, setLocation] = useState<GraphLocationChoice>('project')
  const [projectId, setProjectId] = useState<string | null>(null)
  const [folder, setFolder] = useState<string | null>(null)
  // null = follow the title; set once the user edits the path.
  const [customRelative, setCustomRelative] = useState<string | null>(null)
  const [browserOpen, setBrowserOpen] = useState(false)
  const [openPathInput, setOpenPathInput] = useState<string | null>(null)

  const createGraph = useCreateGraph()
  const openGraphFile = useOpenGraphFile()

  const selectedProject =
    projects.find(p => p.id === projectId) ?? projects[0] ?? null
  const relative =
    customRelative ??
    (location === 'folder'
      ? `${slugify(title)}.yml`
      : defaultRepoGraphPath(title))
  const base = location === 'project' ? selectedProject?.path : folder
  const absolutePath = composeGraphPath(base, relative)

  const debouncedPath = useDebouncedValue(absolutePath, 300)
  const { data: info } = useGraphLocationInfo(debouncedPath)

  const handleLocationChange = useCallback((value: string) => {
    setLocation(value as GraphLocationChoice)
    setCustomRelative(null)
  }, [])

  const handleBrowse = useCallback(async () => {
    // Remote backends browse the server's filesystem.
    if (!isLocalBackend()) {
      setBrowserOpen(true)
      return
    }
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Choose a folder for the graph',
    })
    if (typeof selected === 'string') setFolder(selected)
  }, [])

  const handleCreate = useCallback(async () => {
    if (!absolutePath || !title.trim()) return
    try {
      const summary = await createGraph.mutateAsync({
        title: title.trim(),
        graphType: graphType.trim() || 'roadmap',
        path: absolutePath,
      })
      onDone()
      openGraphView(summary.id)
    } catch {
      // The mutation already toasted.
    }
  }, [absolutePath, title, graphType, createGraph, onDone])

  const openExisting = useCallback(
    async (path: string) => {
      try {
        const summary = await openGraphFile.mutateAsync({ path })
        onDone()
        openGraphView(summary.id)
      } catch {
        // The mutation already toasted.
      }
    },
    [openGraphFile, onDone]
  )

  const handleOpenExisting = useCallback(async () => {
    // Remote backends: no native picker for the server's files, type a path.
    if (!isLocalBackend()) {
      setOpenPathInput('')
      return
    }
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({
      multiple: false,
      directory: false,
      title: 'Open a graph file',
      filters: [{ name: 'Graph', extensions: ['yml', 'yaml'] }],
    })
    if (typeof selected === 'string') await openExisting(selected)
  }, [openExisting])

  const canCreate =
    !!title.trim() && !!absolutePath && !createGraph.isPending && !info?.exists

  return (
    <>
      <DialogHeader>
        <DialogTitle>New graph</DialogTitle>
        <DialogDescription>
          A graph is a YAML file. A roadmap, a release plan or a research map;
          sessions can serve its nodes.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-graph-title">Title</Label>
          <Input
            id="new-graph-title"
            autoFocus
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Release 1.2"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-graph-type">
            Type{' '}
            <span className="font-normal text-muted-foreground">free word</span>
          </Label>
          <Input
            id="new-graph-type"
            value={graphType}
            onChange={e => setGraphType(e.target.value)}
          />
          <div className="flex flex-wrap gap-1.5">
            {GRAPH_TYPE_SUGGESTIONS.map(suggestion => (
              <button
                key={suggestion}
                type="button"
                onClick={() => setGraphType(suggestion)}
                className={cn(
                  'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                  graphType === suggestion
                    ? 'border-foreground text-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground'
                )}
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label>Where the file goes</Label>
          <RadioGroup
            value={location}
            onValueChange={handleLocationChange}
            className="gap-2"
          >
            {LOCATION_OPTIONS.map(option => (
              <label
                key={option.value}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2',
                  location === option.value
                    ? 'border-foreground/60'
                    : 'border-border'
                )}
              >
                <RadioGroupItem
                  value={option.value}
                  className="mt-0.5"
                  aria-label={option.label}
                />
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{option.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {option.description}
                  </span>
                </span>
              </label>
            ))}
          </RadioGroup>

          <div className="flex gap-2">
            {location === 'project' ? (
              <NativeSelect
                aria-label="Project"
                value={selectedProject?.id ?? ''}
                onChange={e => setProjectId(e.target.value)}
                className="w-44"
              >
                {projects.length === 0 && (
                  <NativeSelectOption value="">No projects</NativeSelectOption>
                )}
                {projects.map(project => (
                  <NativeSelectOption key={project.id} value={project.id}>
                    {project.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={handleBrowse}
                className="max-w-56 shrink-0 justify-start"
                title={folder ?? undefined}
              >
                <FolderOpen className="size-4" aria-hidden="true" />
                <span className="truncate">
                  {folder ? tildePath(folder) : 'Choose folder…'}
                </span>
              </Button>
            )}
            <Input
              aria-label={location === 'folder' ? 'File name' : 'Path in repo'}
              value={relative}
              onChange={e => setCustomRelative(e.target.value)}
              className="flex-1"
            />
          </div>
          <LocationInfoLine path={absolutePath} info={info} />
        </div>

        {openPathInput !== null && (
          <div className="flex gap-2">
            <Input
              aria-label="Graph file path"
              placeholder="/path/to/graph.yml"
              value={openPathInput}
              onChange={e => setOpenPathInput(e.target.value)}
              autoFocus
            />
            <Button
              type="button"
              variant="outline"
              disabled={!openPathInput.trim() || openGraphFile.isPending}
              onClick={() => openExisting(openPathInput.trim())}
            >
              Open
            </Button>
          </div>
        )}
      </div>

      <DialogFooter className="items-center sm:justify-between">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleOpenExisting}
          className="text-muted-foreground"
        >
          <FileText className="size-4" aria-hidden="true" />
          Open existing graph file…
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="button" disabled={!canCreate} onClick={handleCreate}>
            Create graph
          </Button>
        </div>
      </DialogFooter>

      <DirectoryBrowser
        open={browserOpen}
        onOpenChange={setBrowserOpen}
        onSelect={setFolder}
        mode="select"
        title="Choose a folder for the graph"
      />
    </>
  )
}

function LocationInfoLine({
  path,
  info,
}: {
  path: string | null
  info: ReturnType<typeof useGraphLocationInfo>['data']
}) {
  if (!path) {
    return (
      <p className="text-xs text-muted-foreground">
        Choose where the file goes.
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
      <p className="truncate font-mono" title={path}>
        {tildePath(path)}
      </p>
      {info && (
        <p
          className="flex items-center gap-1"
          data-testid="graph-location-info"
        >
          {info.repoRoot ? (
            <>
              <GitBranch className="size-3" aria-hidden="true" />
              git repo
              {info.branch && (
                <>
                  {' · on '}
                  <span className="font-medium text-foreground">
                    {info.branch}
                  </span>
                </>
              )}
              {!info.exists && ' · the file is new: "Commit graph" adds it.'}
            </>
          ) : (
            'no git: not versioned'
          )}
        </p>
      )}
      {info?.offDefaultBranch && (
        <p className="flex items-center gap-1 text-amber-500">
          <AlertTriangle className="size-3" aria-hidden="true" />
          The checkout is on {info.branch}, not{' '}
          {info.defaultBranch ?? 'the default branch'}.
        </p>
      )}
      {info?.exists && (
        <p className="flex items-center gap-1 text-destructive">
          <AlertTriangle className="size-3" aria-hidden="true" />A file already
          exists there. Use &ldquo;Open existing graph file…&rdquo;.
        </p>
      )}
    </div>
  )
}
