import type React from 'react'
import { useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { PRODUCT_NAME } from '@/lib/build-info'
import { isClientLinux, isClientMacOS, openExternal } from '@/lib/platform'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useUIStore } from '@/store/ui-store'
import { useIsHomeActive } from '@/components/home/useIsHomeActive'
import { useCommandContext } from '@/lib/commands'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpCircle,
  Download,
  FolderTree,
  Github,
  Heart,
  Minimize2,
  PanelLeft,
  PanelLeftClose,
  Search,
  Settings,
  X,
} from '@/components/icons/reicon'
import { goBack, goForward } from '@/lib/navigation-history'
import { useNavigationHistoryStore } from '@/store/navigation-history-store'
import { usePreferences } from '@/services/preferences'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { CLI_DISPLAY_NAMES, resolveCliPathUpdateAction } from '@/lib/cli-update'
import type { PendingCliUpdate } from '@/store/ui-store'
import { toast } from 'sonner'
import { formatShortcutDisplay, DEFAULT_KEYBINDINGS } from '@/types/keybindings'
import { aggregatesServers, isNativeApp } from '@/lib/environment'
import { UnreadBell } from '@/components/unread/UnreadBell'
import { useIsMobile } from '@/hooks/use-mobile'
import { FALLBACK_APP_VERSION } from '@/lib/app-version'
import { applyServerUpdate } from '@/hooks/useServerUpdateCheck'
import { LinuxWindowControls } from './LinuxWindowControls'
import { UsagePopover } from './UsagePopover'
import { RemoteConnectionsDialog } from '@/components/remote/RemoteConnectionsDialog'
import { useRemoteConnections } from '@/lib/remote-connections'
import { useProjectsStore } from '@/store/projects-store'
import { resolveHeaderServerLabel } from './server-context'
import { MinimizedCliUpdate } from './MinimizedCliUpdate'

/** The desktop title bar's icon buttons. A phone's title bar has none. */
const titleBarButtonClass =
  'size-6 rounded-none text-foreground/70 hover:text-foreground'

interface TitleBarProps {
  className?: string
  title?: string
  hideTitle?: boolean
}

export function TitleBar({
  className,
  title = PRODUCT_NAME,
  hideTitle = false,
}: TitleBarProps) {
  const leftSidebarVisible = useUIStore(state => state.leftSidebarVisible)
  const toggleLeftSidebar = useUIStore(state => state.toggleLeftSidebar)
  // Home has nothing to browse and hides the file browser, so the toggle is
  // disabled there rather than showing "pressed" over an empty space.
  const isHomeActive = useIsHomeActive()
  const fileBrowserVisible =
    useUIStore(state => state.fileBrowserVisible) && !isHomeActive
  const toggleFileBrowser = useUIStore(state => state.toggleFileBrowser)
  const zenMode = useUIStore(state => state.zenMode)
  const toggleZenMode = useUIStore(state => state.toggleZenMode)
  const commandContext = useCommandContext()
  const { data: preferences } = usePreferences()
  const isMobile = useIsMobile()

  const sidebarShortcut = formatShortcutDisplay(
    (preferences?.keybindings?.toggle_left_sidebar ||
      DEFAULT_KEYBINDINGS.toggle_left_sidebar) as string
  )
  const fileBrowserShortcut = formatShortcutDisplay(
    (preferences?.keybindings?.toggle_file_browser ||
      DEFAULT_KEYBINDINGS.toggle_file_browser) as string
  )
  const native = isNativeApp()
  // Only the main window mixes servers, so only it needs to say which one the
  // selected project lives on. A connection window names its remote in the
  // window title instead.
  const aggregates = aggregatesServers()
  const selectedProjectId = useProjectsStore(state => state.selectedProjectId)
  const remoteConnections = useRemoteConnections()
  const serverLabel = resolveHeaderServerLabel(
    selectedProjectId,
    remoteConnections
  )

  const [appVersion, setAppVersion] = useState<string>(FALLBACK_APP_VERSION)
  useEffect(() => {
    if (!native) return

    import('@tauri-apps/api/app')
      .then(({ getVersion }) => getVersion())
      .then(setAppVersion)
      .catch(() => setAppVersion(FALLBACK_APP_VERSION))
  }, [native])

  const barClass = cn(
    'relative flex h-[var(--titlebar-height)] w-full shrink-0 items-center justify-between',
    // Pad out the status bar / notch so items-center centres the content in
    // the strip below it, while the background still paints behind it.
    'pt-[var(--safe-area-top)] pl-[var(--safe-area-left)] pr-[var(--safe-area-right)]',
    'bg-background/80 md:px-2',
    native ? 'z-[60]' : 'z-50',
    className
  )
  const dragRegion = native ? { 'data-tauri-drag-region': true } : {}

  // A phone's title bar is only its title. What the desktop bar carries lives
  // in the tab bar there: Settings (with usage around its icon, updates and the
  // About links), the unread count on Home, and the file browser in the session
  // header. Zen mode hides the tab bar and the session header, so the exit stays.
  if (isMobile) {
    return (
      <div {...dragRegion} className={barClass} data-testid="titlebar-mobile">
        <span className="min-w-0 flex-1 truncate px-12 text-center text-sm font-semibold text-foreground">
          {hideTitle ? '' : title}
        </span>
        {zenMode && (
          <Button
            onClick={toggleZenMode}
            variant="ghost"
            size="icon"
            className="absolute right-[calc(var(--safe-area-right)+0.25rem)] bottom-0 size-11 rounded-none text-foreground/70 hover:text-foreground"
            aria-label="Exit zen mode"
            data-testid="toggle-zen-mode"
          >
            <Minimize2 className="size-4" />
          </Button>
        )}
      </div>
    )
  }

  return (
    <div {...dragRegion} className={barClass}>
      {/* Left side - Window Controls + Left Actions (hidden in zen mode) */}
      <div
        className="flex items-center"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* macOS traffic-light inset even when action buttons are hidden */}
        {zenMode && native && isClientMacOS && (
          <div className="pl-[80px]" aria-hidden />
        )}
        {/* Left Action Buttons */}
        {!zenMode && (
          <div
            className={cn(
              'relative z-10 flex items-center gap-1',
              native && isClientMacOS ? 'mac-titlebar-actions' : 'pl-2 pt-1'
            )}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={toggleLeftSidebar}
                  variant="ghost"
                  size="icon"
                  className={titleBarButtonClass}
                >
                  {leftSidebarVisible ? (
                    <PanelLeftClose className="size-3.5" />
                  ) : (
                    <PanelLeft className="size-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {leftSidebarVisible ? 'Hide' : 'Show'} Left Sidebar{' '}
                <kbd className="ml-1 text-[0.625rem] opacity-60">
                  {sidebarShortcut}
                </kbd>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={toggleFileBrowser}
                  disabled={isHomeActive}
                  variant="ghost"
                  size="icon"
                  className={cn(
                    titleBarButtonClass,
                    fileBrowserVisible && 'text-foreground bg-muted/50'
                  )}
                  aria-pressed={fileBrowserVisible}
                  aria-label={
                    fileBrowserVisible
                      ? 'Hide file browser'
                      : 'Show file browser'
                  }
                  data-testid="toggle-file-browser"
                >
                  <FolderTree className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {fileBrowserVisible ? 'Hide' : 'Show'} File Browser{' '}
                <kbd className="ml-1 text-[0.625rem] opacity-60">
                  {fileBrowserShortcut}
                </kbd>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={commandContext.openPreferences}
                  variant="ghost"
                  size="icon"
                  className={titleBarButtonClass}
                >
                  <Settings className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                Settings{' '}
                <kbd className="ml-1 text-[0.625rem] opacity-60">
                  {formatShortcutDisplay(
                    (preferences?.keybindings?.open_preferences ||
                      DEFAULT_KEYBINDINGS.open_preferences) as string
                  )}
                </kbd>
              </TooltipContent>
            </Tooltip>
            {native && <RemoteConnectionsDialog />}
            <UsagePopover />
            <NavigationButtons />
          </div>
        )}
      </div>

      {/* Center - Title */}
      <div
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 max-w-[50%] px-2"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-2">
          {!hideTitle && (
            <span className="block truncate text-sm font-medium text-foreground/80">
              {title}
            </span>
          )}
          {aggregates && (
            <span
              className="flex shrink-0 items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
              aria-label={`Current Jean server: ${serverLabel}`}
            >
              {serverLabel}
            </span>
          )}
        </div>
      </div>

      {/* Right side - Unread badge, updates, links, version + Windows/Linux
          window controls. Only the unread badge survives zen mode. */}
      <div
        className="flex items-center pt-1"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <UnreadBell />
        {!zenMode && (
          <>
            <MinimizedCliUpdate />
            <CliUpdatesIndicator />
            <ServerUpdateIndicator />
            {appVersion && <UpdateIndicator />}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={() =>
                    openExternal('https://github.com/coollabsio/jean')
                  }
                  variant="ghost"
                  size="icon"
                  className={titleBarButtonClass}
                >
                  <Github className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>GitHub</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={() =>
                    openExternal('https://jean.build/sponsorships/')
                  }
                  variant="ghost"
                  size="icon"
                  className={cn(
                    titleBarButtonClass,
                    'text-pink-500 hover:text-pink-400'
                  )}
                >
                  <Heart className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Sponsor</TooltipContent>
            </Tooltip>
          </>
        )}
        {native && isClientLinux && <LinuxWindowControls />}
      </div>
    </div>
  )
}

/** Back / Go to / Forward, set off from the other left buttons by a fixed gap. */
function NavigationButtons() {
  const canGoBack = useNavigationHistoryStore(state => state.index > 0)
  const canGoForward = useNavigationHistoryStore(
    state => state.index < state.entries.length - 1
  )
  const { data: preferences } = usePreferences()
  const native = isNativeApp()

  const shortcut = (action: 'navigate_back' | 'navigate_forward') =>
    formatShortcutDisplay(
      (preferences?.keybindings?.[action] ||
        DEFAULT_KEYBINDINGS[action]) as string
    )
  const buttonClass = titleBarButtonClass

  return (
    <div className="ml-4 flex items-center gap-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            onClick={goBack}
            disabled={!canGoBack}
            variant="ghost"
            size="icon"
            className={buttonClass}
            aria-label="Go back"
            data-testid="navigate-back"
          >
            <ArrowLeft className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Back
          {native && (
            <kbd className="ml-1 text-[0.625rem] opacity-60">
              {shortcut('navigate_back')}
            </kbd>
          )}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            onClick={() => useUIStore.getState().setCommandPaletteOpen(true)}
            variant="ghost"
            size="icon"
            className={buttonClass}
            aria-label="Go to"
            data-testid="navigate-goto"
          >
            <Search className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Go to…
          {native && (
            <kbd className="ml-1 text-[0.625rem] opacity-60">
              {formatShortcutDisplay('mod+k')}
            </kbd>
          )}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            onClick={goForward}
            disabled={!canGoForward}
            variant="ghost"
            size="icon"
            className={buttonClass}
            aria-label="Go forward"
            data-testid="navigate-forward"
          >
            <ArrowRight className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Forward
          {native && (
            <kbd className="ml-1 text-[0.625rem] opacity-60">
              {shortcut('navigate_forward')}
            </kbd>
          )}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

export function CliUpdatesIndicator() {
  const updates = useUIStore(state => state.availableCliUpdates)
  const dismissCliUpdateNotice = useUIStore(
    state => state.dismissCliUpdateNotice
  )
  const openCliUpdateModal = useUIStore(state => state.openCliUpdateModal)
  const openCliLoginModal = useUIStore(state => state.openCliLoginModal)
  const [open, setOpen] = useState(false)

  const triggerUpdate = useCallback(
    (update: PendingCliUpdate) => {
      if (update.cliSource === 'path') {
        const action = resolveCliPathUpdateAction(
          update.type,
          update.cliPath,
          update.packageManager,
          update.latestVersion
        )
        if (action) {
          openCliLoginModal(update.type, action[0], action[1], 'update')
        } else {
          toast.error(
            `Can't auto-update ${CLI_DISPLAY_NAMES[update.type]}. Update it manually via your package manager.`
          )
          return
        }
      } else {
        openCliUpdateModal(update.type)
      }
      dismissCliUpdateNotice(update.type)
    },
    [dismissCliUpdateNotice, openCliUpdateModal, openCliLoginModal]
  )

  // Auto-close popover when all updates have been acted on / dismissed
  useEffect(() => {
    if (updates.length === 0) setOpen(false)
  }, [updates.length])

  if (updates.length === 0) return null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="relative mr-1.5 flex items-center gap-1 rounded-md bg-primary/15 px-1.5 py-0.5 text-[0.625rem] font-medium text-primary hover:bg-primary/25 transition-colors cursor-pointer"
            >
              <Download className="size-3" />
              <span>{updates.length}</span>
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {updates.length} CLI update{updates.length > 1 ? 's' : ''} available
        </TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-72 p-0">
        <div className="divide-y">
          {updates.map(update => (
            <div
              key={update.type}
              className="flex items-center justify-between px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-xs font-medium truncate">
                  {CLI_DISPLAY_NAMES[update.type]}
                </p>
                <p className="text-[0.625rem] text-muted-foreground">
                  v{update.currentVersion} → v{update.latestVersion}
                </p>
              </div>
              <div className="flex items-center gap-1 ml-2 shrink-0">
                <button
                  type="button"
                  onClick={() => triggerUpdate(update)}
                  className="rounded px-2 py-0.5 text-[0.625rem] font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer"
                >
                  Update
                </button>
                <button
                  type="button"
                  onClick={() => dismissCliUpdateNotice(update.type)}
                  aria-label="Dismiss update notice"
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                >
                  <X className="size-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function ServerUpdateIndicator() {
  const pending = useUIStore(state => state.pendingServerUpdate)
  if (!pending) return null

  const handleClick = () => {
    if (!pending.canUpdate) {
      toast.info(`jean-server ${pending.latestVersion} is available`, {
        id: 'server-update-available',
        description:
          pending.reason ||
          'This host cannot self-update. Replace the binary or image manually.',
        duration: 12_000,
      })
      return
    }
    void applyServerUpdate(pending.latestVersion)
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={handleClick}
          className="mr-1.5 flex items-center gap-1 rounded-md bg-primary/15 px-1.5 py-0.5 text-[0.625rem] font-medium text-primary hover:bg-primary/25 transition-colors cursor-pointer"
        >
          <ArrowUpCircle className="size-3.5" />
          Server update
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {pending.canUpdate
          ? `Update jean-server to v${pending.latestVersion} (currently v${pending.currentVersion})`
          : `jean-server v${pending.latestVersion} available — ${pending.reason || 'manual update required'}`}
      </TooltipContent>
    </Tooltip>
  )
}

export function UpdateIndicator() {
  const pendingVersion = useUIStore(state => state.pendingUpdateVersion)
  const readyVersion = useUIStore(state => state.updateReadyVersion)
  const isInstalling = useUIStore(state => state.isUpdateInstalling)

  // Ready takes priority; also show while deferred or mid-download so the user
  // keeps a visible affordance after dismissing the modal.
  const version = readyVersion ?? pendingVersion
  if (!version && !isInstalling) return null

  const label = readyVersion
    ? 'Restart to update'
    : isInstalling
      ? 'Updating…'
      : 'Update available'
  const tooltip = readyVersion
    ? `Restart to apply v${readyVersion}`
    : isInstalling
      ? version
        ? `Downloading v${version}…`
        : 'Downloading update…'
      : `Update to v${version}`

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => {
            if (isInstalling && !readyVersion) return
            window.dispatchEvent(new Event('install-pending-update'))
          }}
          disabled={isInstalling && !readyVersion}
          className="mr-1.5 flex items-center gap-1 rounded-md bg-primary/15 px-1.5 py-0.5 text-[0.625rem] font-medium text-primary hover:bg-primary/25 transition-colors cursor-pointer disabled:opacity-70 disabled:cursor-default"
        >
          <ArrowUpCircle className="size-3.5" />
          {label}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{tooltip}</TooltipContent>
    </Tooltip>
  )
}

export default TitleBar
