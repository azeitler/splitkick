import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Plus,
  AlertTriangle,
  ChevronDown,
  Search,
  Server,
  Settings,
  Settings2,
} from '@/components/icons/reicon'
import { Input } from '@/components/ui/input'
import { useSidebarWidth } from '@/components/layout/SidebarWidthContext'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { RemoteConnectionsDialog } from '@/components/remote/RemoteConnectionsDialog'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useProjects } from '@/services/projects'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import { useIsMobile } from '@/hooks/use-mobile'
import { ProjectTree } from './ProjectTree'
import { useInstalledBackends } from '@/hooks/useInstalledBackends'
import { scheduleIdleWork } from '@/lib/idle'
import { isNativeApp } from '@/lib/environment'
import { useServerConnectionSnapshots } from '@/lib/server-connections'
import {
  ALL_SERVERS,
  filterProjectsByServer,
  projectServerId,
} from './server-filter'

/** Close the mobile projects drawer when leaving into a dialog/modal. */
function closeMobileSidebarIfNeeded(isMobile: boolean) {
  if (isMobile) {
    useUIStore.getState().setLeftSidebarVisible(false)
  }
}

export function ProjectsSidebar() {
  const {
    data: projects = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useProjects()
  const { setAddProjectDialogOpen } = useProjectsStore()
  const sidebarWidth = useSidebarWidth()
  const isMobile = useIsMobile()
  const [backendCheckReady, setBackendCheckReady] = useState(false)
  const serverFilter = useProjectsStore(
    state => state.sidebarServerFilter ?? ALL_SERVERS
  )
  const setServerFilter = useProjectsStore(
    state => state.setSidebarServerFilter
  )
  const [connectionsOpen, setConnectionsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const serverSnapshots = useServerConnectionSnapshots()
  const serverIds = useMemo(
    () => [...new Set(projects.map(projectServerId))],
    [projects]
  )
  const showServerMenu = isNativeApp()
  const showServerFilter = showServerMenu && serverIds.length > 1
  const visibleProjects = showServerFilter
    ? filterProjectsByServer(projects, serverFilter)
    : projects
  useEffect(() => {
    if (serverFilter !== ALL_SERVERS && !serverIds.includes(serverFilter)) {
      setServerFilter(ALL_SERVERS)
    }
  }, [serverFilter, serverIds, setServerFilter])
  const selectedServerLabel =
    serverFilter === ALL_SERVERS
      ? 'All servers'
      : (serverSnapshots.get(serverFilter)?.name ??
        projects.find(project => projectServerId(project) === serverFilter)
          ?.serverName ??
        'Local')
  useEffect(() => scheduleIdleWork(() => setBackendCheckReady(true), 1500), [])
  const { installedBackends } = useInstalledBackends({
    enabled: backendCheckReady,
  })
  const setupIncomplete = installedBackends.length === 0

  const handleNewProject = useCallback(() => {
    closeMobileSidebarIfNeeded(isMobile)
    setAddProjectDialogOpen(true)
  }, [isMobile, setAddProjectDialogOpen])

  const handleOpenSettings = useCallback(() => {
    closeMobileSidebarIfNeeded(isMobile)
    useUIStore.getState().togglePreferences()
  }, [isMobile])

  return (
    <div className="flex h-full flex-col">
      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="border-b border-border/40 pb-2 pt-[3px]">
          {showServerMenu && (
            <div className="px-3 pb-1 pt-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Filter projects by server"
                    className="flex h-7 w-full items-center gap-2 rounded-md border border-transparent bg-transparent px-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <Server className="size-3.5" />
                    <span className="min-w-0 flex-1 truncate text-left">
                      {selectedServerLabel}
                    </span>
                    <ChevronDown className="size-3.5 opacity-50" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="border-border/60 bg-popover/95 shadow-lg backdrop-blur-sm"
                  style={{ width: sidebarWidth - 24 }}
                >
                  <DropdownMenuRadioGroup
                    value={serverFilter}
                    onValueChange={setServerFilter}
                  >
                    <DropdownMenuRadioItem
                      value={ALL_SERVERS}
                      className="text-xs"
                    >
                      All servers
                    </DropdownMenuRadioItem>
                    {serverIds.map(serverId => {
                      const snapshot = serverSnapshots.get(serverId)
                      const fallback = projects.find(
                        project => projectServerId(project) === serverId
                      )?.serverName
                      const status = snapshot?.status
                      const statusLabel =
                        status && status !== 'local' && status !== 'online'
                          ? ` (${status})`
                          : ''
                      return (
                        <DropdownMenuRadioItem
                          key={serverId}
                          value={serverId}
                          className="text-xs"
                        >
                          {snapshot?.name ?? fallback ?? 'Local'}
                          {statusLabel}
                        </DropdownMenuRadioItem>
                      )
                    })}
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-xs text-muted-foreground"
                    onSelect={() => setConnectionsOpen(true)}
                  >
                    <Settings2 className="size-3.5" />
                    Connections
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <RemoteConnectionsDialog
                open={connectionsOpen}
                onOpenChange={setConnectionsOpen}
                showTrigger={false}
              />
            </div>
          )}
          <div
            className={
              showServerMenu ? 'flex gap-2 px-3' : 'flex gap-2 px-3 pt-2'
            }
          >
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                placeholder="Search projects…"
                aria-label="Search projects and worktrees"
                className="h-8 bg-background/40 pl-7 pr-2 text-xs shadow-none"
              />
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                  onClick={handleNewProject}
                  disabled={!backendCheckReady || setupIncomplete}
                  aria-label="Add project"
                >
                  <Plus className="size-5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Add project</TooltipContent>
            </Tooltip>
          </div>
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center p-4">
            <span className="text-sm text-muted-foreground">Loading...</span>
          </div>
        ) : isError && projects.length === 0 ? (
          <div
            className="flex h-full flex-col items-center justify-center gap-2 px-3 text-center"
            role="alert"
          >
            <AlertTriangle className="size-4 text-destructive" />
            <span className="text-sm text-muted-foreground">
              Unable to load projects
            </span>
            <span className="text-xs text-muted-foreground/70">
              Your project data may be corrupted. Jean kept the file unchanged
              so it can be recovered.
            </span>
            <button
              type="button"
              className="text-xs text-primary underline-offset-4 hover:underline"
              onClick={() => void refetch()}
            >
              Retry
            </button>
            {error && (
              <span className="sr-only">
                {error instanceof Error ? error.message : String(error)}
              </span>
            )}
          </div>
        ) : projects.length === 0 ? (
          <div className="flex h-full items-center justify-center px-2">
            <span className="truncate text-sm text-muted-foreground/50">
              No projects found
            </span>
          </div>
        ) : (
          <ProjectTree
            projects={visibleProjects}
            groupByServer={showServerFilter && serverFilter === ALL_SERVERS}
            searchQuery={searchQuery}
          />
        )}
      </div>
      <div className="shrink-0 p-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={handleOpenSettings}
              aria-label="Open Settings"
              data-testid="sidebar-settings"
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Settings className="size-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Settings</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
