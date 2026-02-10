import { useState, useMemo, useEffect } from 'react'
import {
  CheckCircle,
  Loader2,
  GitBranch,
  Check,
  ChevronsUpDown,
  ImageIcon,
  ShieldAlert,
  X,
  XCircle,
} from 'lucide-react'
import { convertFileSrc } from '@/lib/transport'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useProjectsStore } from '@/store/projects-store'
import {
  useProjects,
  useProjectBranches,
  useUpdateProjectSettings,
  useAppDataDir,
  useSetProjectAvatar,
  useRemoveProjectAvatar,
} from '@/services/projects'
import {
  useMcpServers,
  invalidateMcpServers,
  getNewServersToAutoEnable,
  useMcpHealthCheck,
} from '@/services/mcp'
import type { McpHealthStatus } from '@/types/chat'

function ProjectMcpHealthIndicator({
  status,
  isChecking,
}: {
  status: McpHealthStatus | undefined
  isChecking: boolean
}) {
  if (isChecking) {
    return <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
  }
  if (!status) return null

  switch (status) {
    case 'connected':
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <CheckCircle className="size-3.5 text-green-600 dark:text-green-400" />
            </span>
          </TooltipTrigger>
          <TooltipContent>Server is connected and ready</TooltipContent>
        </Tooltip>
      )
    case 'needsAuthentication':
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <ShieldAlert className="size-3.5 text-amber-600 dark:text-amber-400" />
            </span>
          </TooltipTrigger>
          <TooltipContent>{"Run 'claude /mcp' in your terminal to authenticate"}</TooltipContent>
        </Tooltip>
      )
    case 'couldNotConnect':
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <XCircle className="size-3.5 text-red-600 dark:text-red-400" />
            </span>
          </TooltipTrigger>
          <TooltipContent>Could not connect -- check that the server is running</TooltipContent>
        </Tooltip>
      )
    default:
      return null
  }
}

export function ProjectSettingsDialog() {
  const {
    projectSettingsDialogOpen,
    projectSettingsProjectId,
    closeProjectSettings,
  } = useProjectsStore()

  const { data: projects = [] } = useProjects()
  const project = projects.find(p => p.id === projectSettingsProjectId)

  const {
    data: branches = [],
    isLoading: branchesLoading,
    error: branchesError,
  } = useProjectBranches(projectSettingsProjectId)

  const updateSettings = useUpdateProjectSettings()
  const { data: appDataDir = '' } = useAppDataDir()
  const setProjectAvatar = useSetProjectAvatar()
  const removeProjectAvatar = useRemoveProjectAvatar()

  // MCP servers for this project
  const { data: mcpServers = [], isLoading: mcpLoading } = useMcpServers(
    project?.path
  )

  // Health check — triggered when dialog opens
  const {
    data: healthResult,
    isFetching: isHealthChecking,
    refetch: checkHealth,
  } = useMcpHealthCheck()

  // Re-read MCP config from disk and trigger health check when the dialog opens
  useEffect(() => {
    if (projectSettingsDialogOpen && project?.path) {
      invalidateMcpServers(project.path)
      checkHealth()
    }
  }, [projectSettingsDialogOpen, project?.path, checkHealth])

  // Use project's default_branch as the initial value, allow local overrides
  const [localBranch, setLocalBranch] = useState<string | null>(null)
  const [localMcpServers, setLocalMcpServers] = useState<string[] | null>(null)
  const [localSystemPrompt, setLocalSystemPrompt] = useState<string | null>(
    null
  )
  const [branchPopoverOpen, setBranchPopoverOpen] = useState(false)

  // Auto-enable newly discovered (non-disabled) servers for this project
  useEffect(() => {
    if (!projectSettingsDialogOpen || !mcpServers.length) return
    const currentEnabled = project?.enabled_mcp_servers ?? []
    const newServers = getNewServersToAutoEnable(mcpServers, currentEnabled)
    if (newServers.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Intentional: sync local state with newly discovered servers on dialog open
      setLocalMcpServers([...currentEnabled, ...newServers])
    }
  }, [mcpServers, projectSettingsDialogOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  // Track image load errors - use avatar_path as key to reset error state when it changes
  const [imgErrorKey, setImgErrorKey] = useState<string | null>(null)
  const imgError = imgErrorKey === project?.avatar_path

  // Build the full avatar URL if project has an avatar
  const avatarUrl =
    project?.avatar_path && appDataDir && !imgError
      ? convertFileSrc(`${appDataDir}/${project.avatar_path}`)
      : null

  const handleChangeAvatar = () => {
    if (!projectSettingsProjectId) return
    setProjectAvatar.mutate(projectSettingsProjectId)
  }

  const handleRemoveAvatar = () => {
    if (!projectSettingsProjectId) return
    removeProjectAvatar.mutate(projectSettingsProjectId)
  }

  // If user hasn't made a selection, use project's default
  const selectedBranch = localBranch ?? project?.default_branch ?? ''
  const selectedMcpServers =
    localMcpServers ?? project?.enabled_mcp_servers ?? []
  const selectedSystemPrompt =
    localSystemPrompt ?? project?.custom_system_prompt ?? ''

  const setSelectedBranch = (branch: string) => {
    setLocalBranch(branch)
  }

  const handleToggleMcpServer = (serverName: string) => {
    const current = localMcpServers ?? project?.enabled_mcp_servers ?? []
    const updated = current.includes(serverName)
      ? current.filter(n => n !== serverName)
      : [...current, serverName]
    setLocalMcpServers(updated)
  }

  const handleSave = async () => {
    if (!projectSettingsProjectId || !selectedBranch) return

    await updateSettings.mutateAsync({
      projectId: projectSettingsProjectId,
      defaultBranch: selectedBranch,
      enabledMcpServers: localMcpServers ?? undefined,
      customSystemPrompt: localSystemPrompt ?? undefined,
    })

    closeProjectSettings()
  }

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setLocalBranch(null) // Reset local state when closing
      setLocalMcpServers(null)
      setLocalSystemPrompt(null)
      closeProjectSettings()
    }
  }

  const projectMcpServers = useMemo(
    () => project?.enabled_mcp_servers ?? [],
    [project?.enabled_mcp_servers]
  )
  const branchChanged = project && selectedBranch !== project.default_branch
  const mcpChanged =
    localMcpServers !== null &&
    JSON.stringify(localMcpServers.slice().sort()) !==
      JSON.stringify(projectMcpServers.slice().sort())
  const systemPromptChanged =
    localSystemPrompt !== null &&
    localSystemPrompt !== (project?.custom_system_prompt ?? '')
  const hasChanges = branchChanged || mcpChanged || systemPromptChanged
  const isPending = updateSettings.isPending

  return (
    <Dialog open={projectSettingsDialogOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Project Settings</DialogTitle>
          <DialogDescription>
            {project?.name ?? 'Configure project settings'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Avatar Section */}
          <div className="space-y-2">
            <label className="text-sm font-medium leading-none">
              Project Avatar
            </label>
            <p className="text-xs text-muted-foreground">
              Custom image displayed in the sidebar
            </p>
            <div className="flex items-center gap-3">
              {/* Avatar Preview */}
              <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-muted-foreground/20 overflow-hidden">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt={project?.name ?? 'Project avatar'}
                    className="size-full object-cover"
                    onError={() => setImgErrorKey(project?.avatar_path ?? null)}
                  />
                ) : (
                  <span className="text-lg font-medium uppercase text-muted-foreground">
                    {project?.name?.[0] ?? '?'}
                  </span>
                )}
              </div>
              {/* Avatar Actions */}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleChangeAvatar}
                  disabled={setProjectAvatar.isPending}
                >
                  {setProjectAvatar.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ImageIcon className="h-4 w-4" />
                  )}
                  {project?.avatar_path ? 'Change' : 'Add Image'}
                </Button>
                {project?.avatar_path && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRemoveAvatar}
                    disabled={removeProjectAvatar.isPending}
                  >
                    {removeProjectAvatar.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <X className="h-4 w-4" />
                    )}
                    Remove
                  </Button>
                )}
              </div>
            </div>
          </div>

          {/* Base Branch Section */}
          <div className="space-y-2">
            <label
              htmlFor="base-branch"
              className="text-sm font-medium leading-none"
            >
              Base Branch
            </label>
            <p className="text-xs text-muted-foreground">
              New worktrees will be created from this branch
            </p>

            {branchesLoading ? (
              <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Fetching branches...
              </div>
            ) : branchesError ? (
              <div className="py-2 text-sm text-destructive">
                Failed to load branches
              </div>
            ) : branches.length === 0 ? (
              <div className="py-2 text-sm text-muted-foreground">
                No branches found
              </div>
            ) : (
              <Popover
                open={branchPopoverOpen}
                onOpenChange={setBranchPopoverOpen}
              >
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={branchPopoverOpen}
                    className="w-full justify-between"
                  >
                    <span className="flex items-center gap-2 truncate">
                      <GitBranch className="h-4 w-4 shrink-0" />
                      {selectedBranch || 'Select a branch'}
                    </span>
                    <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="!w-[var(--radix-popover-trigger-width)] p-0"
                >
                  <Command>
                    <CommandInput placeholder="Search branches..." />
                    <CommandList>
                      <CommandEmpty>No branch found.</CommandEmpty>
                      <CommandGroup>
                        {branches.map(branch => (
                          <CommandItem
                            key={branch}
                            value={branch}
                            onSelect={value => {
                              setSelectedBranch(value)
                              setBranchPopoverOpen(false)
                            }}
                          >
                            <GitBranch className="h-4 w-4" />
                            {branch}
                            <Check
                              className={cn(
                                'ml-auto h-4 w-4',
                                selectedBranch === branch
                                  ? 'opacity-100'
                                  : 'opacity-0'
                              )}
                            />
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            )}
          </div>

          {/* MCP Servers Section */}
          <div className="space-y-2">
            <label className="text-sm font-medium leading-none">
              MCP Servers
            </label>
            <p className="text-xs text-muted-foreground">
              Servers enabled by default for sessions in this project
            </p>

            {mcpLoading ? (
              <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading servers...
              </div>
            ) : mcpServers.length === 0 ? (
              <div className="py-2 text-sm text-muted-foreground">
                No MCP servers found
              </div>
            ) : (
              <div className="space-y-2">
                {mcpServers.map(server => (
                  <div
                    key={server.name}
                    className={cn(
                      'flex items-center gap-3 rounded-md border px-3 py-2',
                      server.disabled && 'opacity-50'
                    )}
                  >
                    <Checkbox
                      id={`proj-mcp-${server.name}`}
                      checked={
                        !server.disabled &&
                        selectedMcpServers.includes(server.name)
                      }
                      onCheckedChange={() => handleToggleMcpServer(server.name)}
                      disabled={server.disabled}
                    />
                    <Label
                      htmlFor={`proj-mcp-${server.name}`}
                      className={cn(
                        'flex-1 text-sm',
                        server.disabled ? 'cursor-default' : 'cursor-pointer'
                      )}
                    >
                      {server.name}
                    </Label>
                    <ProjectMcpHealthIndicator
                      status={healthResult?.statuses[server.name]}
                      isChecking={isHealthChecking}
                    />
                    <span className="text-xs text-muted-foreground">
                      {server.disabled ? 'disabled' : server.scope}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Custom System Prompt Section */}
          <div className="space-y-2">
            <label
              htmlFor="custom-system-prompt"
              className="text-sm font-medium leading-none"
            >
              Custom System Prompt
            </label>
            <p className="text-xs text-muted-foreground">
              Appended to every session&apos;s system prompt in this project
            </p>
            <Textarea
              id="custom-system-prompt"
              placeholder="e.g. Always use TypeScript strict mode. Prefer functional components..."
              value={selectedSystemPrompt}
              onChange={e => setLocalSystemPrompt(e.target.value)}
              rows={4}
              className="resize-y text-sm"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={closeProjectSettings}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={!hasChanges || isPending || branchesLoading}
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
