import { useEffect, useState, useCallback, useMemo } from 'react'
import { useUIStore } from '@/store/ui-store'
import { useCommandContext } from '@/hooks/use-command-context'
import { usePreferences } from '@/services/preferences'
import { useProjects, useAppDataDir } from '@/services/projects'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import {
  useAllSessions,
  useSessionMessageSearch,
  MIN_SESSION_SEARCH_LEN,
} from '@/services/chat'
import { convertFileSrc, convertProjectFileSrc } from '@/lib/transport'
import { cn } from '@/lib/utils'
import { formatRelativeTime } from '@/lib/relative-time'
import {
  navigateToProject,
  navigateToSession,
} from '@/lib/navigate-to-session'
import { getSessionStatus } from '@/components/unread/unread-utils'
import { getBackendIcon } from '@/components/ui/backend-label'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useIsMobile } from '@/hooks/use-mobile'
import { Kbd } from '@/components/ui/kbd'
import { buildSessionCommands } from './session-commands'
import { HighlightedText } from './highlight-matches'
import { getAllCommands, executeCommand } from '@/lib/commands'
import { formatShortcutDisplay } from '@/types/keybindings'
import type { SessionSearchHit } from '@/types/chat'
import { Monitor, Server, Loader2, MessageSquareText } from 'lucide-react'
import {
  LOCAL_CONNECTION_ID,
  getActiveConnectionId,
  getRemoteConnections,
  markConnectionSwitch,
  selectConnection,
  useRemoteConnections,
} from '@/lib/remote-connections'
import {
  fetchRemoteServerInfo,
  warnRemoteVersionMismatch,
} from '@/lib/remote-version'
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
} from '@/components/ui/command'

type PaletteMode = 'quick' | 'search'

const MODES: { id: PaletteMode; label: string }[] = [
  { id: 'quick', label: 'Quick' },
  { id: 'search', label: 'Search messages' },
]

interface ProjectCommand {
  id: string
  label: string
  description?: string
  avatarUrl: string | null
  avatarFallback: string
  group: string
  keywords: string[]
  execute: () => void
}

interface ConnectionCommand {
  id: string
  connectionId: string
  label: string
  description: string
  local: boolean
  keywords: string[]
}

export function CommandPalette({
  reloadApp = () => window.location.reload(),
}: {
  reloadApp?: () => void
} = {}) {
  const commandPaletteOpen = useUIStore(state => state.commandPaletteOpen)
  const setCommandPaletteOpen = useUIStore(state => state.setCommandPaletteOpen)
  const sessionChatModalWorktreeId = useUIStore(
    state => state.sessionChatModalWorktreeId
  )
  const { data: preferences } = usePreferences()
  const commandContext = useCommandContext(preferences)
  const [search, setSearch] = useState('')
  // 'quick' filters loaded data instantly. 'search' runs a debounced backend
  // scan over message content, which is why it is a separate mode and not
  // another group in the same list.
  const [mode, setMode] = useState<PaletteMode>('quick')
  const isMobile = useIsMobile()
  const remoteConnections = useRemoteConnections()
  const activeConnectionId = getActiveConnectionId()

  // Fetch projects for dynamic commands
  const { data: projects = [] } = useProjects()
  const { data: appDataDir } = useAppDataDir()

  // Sessions across every project. The ['all-sessions'] cache is already kept
  // warm app-wide by the unread bell, so this dedupes onto the same key.
  const { data: allSessions } = useAllSessions(commandPaletteOpen)
  const sessionLabels = useChatStore(state => state.sessionLabels)

  // The session already on screen (inline chat, or the canvas session modal)
  const activeSessionId = useChatStore(state => {
    const worktreeId = state.activeWorktreeId ?? sessionChatModalWorktreeId
    return worktreeId ? (state.activeSessionIds[worktreeId] ?? null) : null
  })

  // Get project access timestamps for recency sorting
  const projectAccessTimestamps = useProjectsStore(
    state => state.projectAccessTimestamps
  )
  const selectedProjectId = useProjectsStore(state => state.selectedProjectId)

  const connectionCommands = useMemo((): ConnectionCommand[] => {
    const connections: ConnectionCommand[] = [
      {
        id: `switch-connection-${LOCAL_CONNECTION_ID}`,
        connectionId: LOCAL_CONNECTION_ID,
        label: 'Localhost',
        description: 'This device',
        local: true,
        keywords: ['connection', 'switch', 'local', 'localhost', 'device'],
      },
      ...remoteConnections.map(connection => ({
        id: `switch-connection-${connection.id}`,
        connectionId: connection.id,
        label: connection.name,
        description: connection.url,
        local: false,
        keywords: [
          'connection',
          'switch',
          'remote',
          connection.name.toLowerCase(),
          connection.url.toLowerCase(),
        ],
      })),
    ]

    return connections.filter(
      connection => connection.connectionId !== activeConnectionId
    )
  }, [activeConnectionId, remoteConnections])

  // Every keystroke would otherwise walk the run logs on disk.
  const debouncedQuery = useDebouncedValue(search, 250)
  const { data: searchData, isFetching: isSearching } = useSessionMessageSearch(
    debouncedQuery,
    commandPaletteOpen && mode === 'search'
  )
  const searchHits = searchData?.hits ?? []
  const highlightQuery = debouncedQuery.trim()

  // Sessions lead the palette: jumping back to a session is the most common
  // reason to open it, so an empty query still lists the most recent ones.
  const sessionCommands = useMemo(
    () =>
      buildSessionCommands({
        entries: allSessions?.entries ?? [],
        sessionLabels,
        query: search,
        excludeSessionId: activeSessionId,
      }),
    [allSessions, sessionLabels, search, activeSessionId]
  )

  // Create dynamic project commands (sorted by last-accessed, most recent first).
  // Every project is listed, but the current one sorts last: the top of a switch
  // list should be where you would go, not where you already are.
  const projectCommands = useMemo((): ProjectCommand[] => {
    return projects
      .filter(p => !p.is_folder)
      .sort((a, b) => {
        if (a.id === selectedProjectId) return 1
        if (b.id === selectedProjectId) return -1
        const aTime = projectAccessTimestamps[a.id] ?? 0
        const bTime = projectAccessTimestamps[b.id] ?? 0
        return bTime - aTime
      })
      .map(project => ({
        id: `goto-project-${project.id}`,
        label: project.name,
        description: project.id === selectedProjectId ? 'Current' : 'Open',
        avatarUrl:
          project.avatar_path && appDataDir
            ? convertFileSrc(`${appDataDir}/${project.avatar_path}`)
            : project.default_avatar_path
              ? convertProjectFileSrc(project.default_avatar_path)
              : null,
        avatarFallback: project.name[0]?.toUpperCase() ?? '?',
        group: 'projects',
        keywords: ['project', 'switch', 'open', project.name.toLowerCase()],
        execute: () => navigateToProject(project.id),
      }))
  }, [projects, appDataDir, projectAccessTimestamps, selectedProjectId])

  // Get all available commands (memoized to prevent re-filtering on every render)
  const commandGroups = useMemo(() => {
    const staticCommands = getAllCommands(commandContext, search)

    // Filter project commands by search
    const searchLower = search.toLowerCase().trim()
    const filteredProjectCommands = searchLower
      ? projectCommands.filter(
          cmd =>
            cmd.label.toLowerCase().includes(searchLower) ||
            cmd.keywords.some(kw => kw.includes(searchLower))
        )
      : projectCommands

    // Group static commands
    const staticGroups = staticCommands.reduce(
      (acc, command) => {
        const group = command.group || 'other'
        if (!acc[group]) acc[group] = []
        acc[group].push(command)
        return acc
      },
      {} as Record<string, typeof staticCommands>
    )

    return { staticGroups, projectCommands: filteredProjectCommands }
  }, [commandContext, search, projectCommands])

  // Handle command execution
  const handleCommandSelect = useCallback(
    async (commandId: string) => {
      setCommandPaletteOpen(false)
      setSearch('') // Clear search when closing

      // Check connection shortcuts before project and static commands
      const connectionCmd = connectionCommands.find(
        command => command.id === commandId
      )
      if (connectionCmd) {
        if (connectionCmd.connectionId !== LOCAL_CONNECTION_ID) {
          const connection = getRemoteConnections().find(
            item => item.id === connectionCmd.connectionId
          )
          if (!connection) {
            commandContext.showToast('Remote connection not found.', 'error')
            return
          }
          // Warn on mismatch but still switch; transport re-checks after load.
          try {
            const info = await fetchRemoteServerInfo(
              connection.url,
              connection.token
            )
            warnRemoteVersionMismatch(info.appVersion)
          } catch {
            // Unreachable remotes still switch so recovery UI can handle them.
          }
        }
        markConnectionSwitch()
        selectConnection(connectionCmd.connectionId)
        reloadApp()
        return
      }

      const sessionCmd = sessionCommands.find(c => c.id === commandId)
      if (sessionCmd) {
        navigateToSession({
          projectId: sessionCmd.projectId,
          worktreeId: sessionCmd.worktreeId,
          sessionId: sessionCmd.session.id,
        })
        return
      }

      const projectCmd = projectCommands.find(c => c.id === commandId)
      if (projectCmd) {
        projectCmd.execute()
        return
      }

      const result = await executeCommand(commandId, commandContext)

      if (!result.success && result.error) {
        commandContext.showToast(result.error, 'error')
      }
    },
    [
      commandContext,
      connectionCommands,
      projectCommands,
      sessionCommands,
      reloadApp,
      setCommandPaletteOpen,
    ]
  )

  const handleSearchHitSelect = useCallback(
    (hit: SessionSearchHit) => {
      setCommandPaletteOpen(false)
      setSearch('')
      navigateToSession({
        projectId: hit.project_id,
        worktreeId: hit.worktree_id,
        sessionId: hit.session_id,
      })
    },
    [setCommandPaletteOpen]
  )

  // Tab toggles the mode. Jean already reads Tab as "cycle a mode" in the chat
  // input, and inside a dialog it would otherwise only move focus.
  const handleInputKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (
      event.key !== 'Tab' ||
      event.shiftKey ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    ) {
      return
    }
    event.preventDefault()
    setMode(current => (current === 'quick' ? 'search' : 'quick'))
  }, [])

  // Handle dialog open/close with search clearing
  const handleOpenChange = useCallback(
    (open: boolean) => {
      setCommandPaletteOpen(open)
      if (!open) {
        setSearch('') // Clear search when closing
        setMode('quick')
      }
    },
    [setCommandPaletteOpen]
  )

  // Keyboard shortcut handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setCommandPaletteOpen(!commandPaletteOpen)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [commandPaletteOpen, setCommandPaletteOpen])

  return (
    <CommandDialog
      open={commandPaletteOpen}
      onOpenChange={handleOpenChange}
      title="Command Palette"
      description="Type a command or search..."
      className="top-4 translate-y-0 sm:top-[10vh] sm:max-w-2xl"
      disablePointerSelection
      shouldFilter={mode === 'quick'}
    >
      <CommandInput
        placeholder={
          mode === 'search'
            ? 'Search across all session messages...'
            : 'Type a command or search...'
        }
        value={search}
        onValueChange={setSearch}
        onKeyDown={handleInputKeyDown}
      />

      <div className="flex items-center gap-1 border-b px-2 py-1.5">
        {MODES.map(item => (
          <button
            key={item.id}
            type="button"
            onClick={() => setMode(item.id)}
            className={cn(
              'rounded-md px-2 py-1 text-xs transition-colors',
              mode === item.id
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/50'
            )}
          >
            {item.label}
          </button>
        ))}
        {isSearching && (
          <Loader2 className="size-3 animate-spin text-muted-foreground" />
        )}
        {!isMobile && (
          <Kbd
            className="ml-auto h-4 px-1 text-[10px] opacity-70"
            title="Switch mode"
          >
            Tab
          </Kbd>
        )}
      </div>
      <CommandList className="max-h-[70dvh] sm:max-h-[min(640px,65dvh)]">
        {mode === 'quick' && <CommandEmpty>No results found.</CommandEmpty>}

        {mode === 'search' && (
          <>
            {search.trim().length < MIN_SESSION_SEARCH_LEN ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Type at least {MIN_SESSION_SEARCH_LEN} characters to search
                message content.
              </div>
            ) : searchHits.length === 0 && !isSearching ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                No messages match “{search.trim()}”.
              </div>
            ) : (
              <CommandGroup
                heading={
                  searchData?.truncated
                    ? `Messages (first ${searchHits.length})`
                    : 'Messages'
                }
              >
                {searchHits.map(hit => (
                  <CommandItem
                    key={hit.session_id}
                    value={hit.session_id}
                    onSelect={() => handleSearchHitSelect(hit)}
                    className="items-start"
                  >
                    <MessageSquareText className="mt-0.5 size-4 shrink-0" />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <HighlightedText
                        text={hit.session_name}
                        query={highlightQuery}
                        className="truncate leading-snug"
                      />
                      <HighlightedText
                        text={hit.snippet}
                        query={highlightQuery}
                        className="truncate text-xs leading-snug text-muted-foreground"
                      />
                      <span className="truncate text-[11px] leading-snug text-muted-foreground/70">
                        {hit.project_name} · {hit.worktree_name}
                        {hit.match_count > 1 && ` · ${hit.match_count} matches`}
                      </span>
                    </div>
                    <span className="ml-2 shrink-0 self-center text-xs text-muted-foreground">
                      {formatRelativeTime(hit.updated_at)}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </>
        )}

        {/* Sessions lead: with no query these are the most recent ones */}
        {mode === 'quick' && sessionCommands.length > 0 && (
          <CommandGroup
            heading={search.trim() ? 'Sessions' : 'Recent Sessions'}
          >
            {sessionCommands.map(cmd => {
              const BackendIcon = getBackendIcon(
                cmd.session.backend ?? 'claude'
              )
              const status = getSessionStatus(cmd.session)
              const StatusIcon = status?.icon
              const activityAt =
                cmd.session.last_message_at ?? cmd.session.updated_at

              return (
                <CommandItem
                  key={cmd.id}
                  value={cmd.searchValue}
                  onSelect={() => handleCommandSelect(cmd.id)}
                  className="items-start"
                >
                  <BackendIcon className="mt-0.5 size-4 shrink-0" />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate leading-snug">{cmd.label}</span>
                    <span className="truncate text-xs leading-snug text-muted-foreground">
                      {cmd.description}
                    </span>
                  </div>
                  <div className="ml-2 flex shrink-0 items-center gap-1.5 self-center">
                    {StatusIcon && (
                      <StatusIcon
                        className={cn('size-3.5', status?.className)}
                        aria-label={status?.label}
                      />
                    )}
                    {activityAt ? (
                      <span className="text-xs text-muted-foreground">
                        {formatRelativeTime(activityAt)}
                      </span>
                    ) : null}
                  </div>
                </CommandItem>
              )
            })}
          </CommandGroup>
        )}

        {/* Projects follow, so CMD+K -> down-arrow still reaches them fast */}
        {mode === 'quick' && commandGroups.projectCommands.length > 0 && (
          <CommandGroup heading="Projects">
            {commandGroups.projectCommands.map(cmd => (
              <CommandItem
                key={cmd.id}
                value={`${cmd.label} ${cmd.description ?? ''} ${cmd.keywords.join(' ')}`}
                onSelect={() => handleCommandSelect(cmd.id)}
                className="items-start"
              >
                {cmd.avatarUrl ? (
                  <img
                    src={cmd.avatarUrl}
                    alt={cmd.label}
                    className="mt-0.5 size-4 shrink-0 rounded object-cover"
                  />
                ) : (
                  <div className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded bg-muted-foreground/20">
                    <span className="text-[10px] font-medium uppercase">
                      {cmd.avatarFallback}
                    </span>
                  </div>
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate leading-snug">{cmd.label}</span>
                  {cmd.description && (
                    <span className="text-xs leading-snug text-muted-foreground">
                      {cmd.description}
                    </span>
                  )}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {mode === 'quick' && connectionCommands.length > 0 && (
          <CommandGroup heading="Connections">
            {connectionCommands.map(command => (
              <CommandItem
                key={command.id}
                value={`${command.label} ${command.description} ${command.keywords.join(' ')}`}
                onSelect={() => handleCommandSelect(command.id)}
                className="items-start"
              >
                {command.local ? (
                  <Monitor className="mt-0.5 size-4 shrink-0" />
                ) : (
                  <Server className="mt-0.5 size-4 shrink-0" />
                )}
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate leading-snug">{command.label}</span>
                  <span className="truncate text-xs leading-snug text-muted-foreground">
                    {command.description}
                  </span>
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Static command groups */}
        {mode === 'quick' &&
          Object.entries(commandGroups.staticGroups).map(
            ([groupName, groupCommands]) => (
              <CommandGroup key={groupName} heading={getGroupLabel(groupName)}>
                {groupCommands.map(command => (
                  <CommandItem
                    key={command.id}
                    value={`${command.id} ${command.label} ${command.description ?? ''} ${command.keywords?.join(' ') ?? ''}`}
                    onSelect={() => handleCommandSelect(command.id)}
                    className="items-start"
                  >
                    {command.icon && (
                      <command.icon className="mt-0.5 size-4 shrink-0" />
                    )}
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate leading-snug">
                        {command.label}
                      </span>
                      {command.description && (
                        <span className="text-xs leading-snug text-muted-foreground">
                          {command.description}
                        </span>
                      )}
                    </div>
                    {command.shortcut && (
                      <CommandShortcut className="self-center">
                        {formatShortcutDisplay(command.shortcut)}
                      </CommandShortcut>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )
          )}
      </CommandList>
    </CommandDialog>
  )
}

// Helper function to get readable group labels
function getGroupLabel(groupName: string): string {
  switch (groupName) {
    case 'navigation':
      return 'Navigation'
    case 'settings':
      return 'Settings'
    case 'window':
      return 'Window'
    case 'notification':
      return 'Notifications'
    case 'github':
      return 'GitHub'
    case 'sessions':
      return 'Session Actions'
    case 'other':
      return 'Other'
    default:
      return groupName.charAt(0).toUpperCase() + groupName.slice(1)
  }
}

export default CommandPalette
