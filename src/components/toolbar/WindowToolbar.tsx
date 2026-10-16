import {
  ChevronLeft,
  ChevronRight,
  FolderTree,
  Minimize2,
  PanelLeft,
  Server,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useUIStore } from '@/store/ui-store'
import { useNavigationHistoryStore } from '@/store/navigation-history-store'
import { goBack, goForward } from '@/lib/navigation-history'
import { isNativeApp } from '@/lib/environment'
import { useActiveRemoteConnection } from '@/lib/remote-connections'
import { isClientLinux, isClientMacOS } from '@/lib/platform'
import { usePreferences } from '@/services/preferences'
import {
  DEFAULT_KEYBINDINGS,
  formatShortcutDisplay,
  type KeybindingAction,
} from '@/types/keybindings'
import { UnreadBell } from '@/components/unread/UnreadBell'
import { useIsHomeActive } from '@/components/home/useIsHomeActive'
import { LinuxWindowControls } from '@/components/titlebar/LinuxWindowControls'
import { useToolbarHasOwner, useToolbarSlotRef } from './toolbar-slots'

/** Icon button in the window chrome: 17 pt glyph, bezel on hover (AppKit). */
export const toolbarButtonClass =
  'h-7 w-[30px] rounded-md text-foreground/70 hover:bg-foreground/10 hover:text-foreground [&_svg]:size-4'

/** Space AppKit keeps free for the traffic lights. */
export const TRAFFIC_LIGHT_INSET = 'w-[78px]'

export function useShortcutLabel(action: KeybindingAction): string {
  const { data: preferences } = usePreferences()
  return formatShortcutDisplay(
    (preferences?.keybindings?.[action] ||
      DEFAULT_KEYBINDINGS[action]) as string
  )
}

function ShortcutHint({ action }: { action: KeybindingAction }) {
  const label = useShortcutLabel(action)
  if (!isNativeApp()) return null
  return <kbd className="ml-1 text-[0.625rem] opacity-60">{label}</kbd>
}

export function SidebarToggleButton() {
  const visible = useUIStore(state => state.leftSidebarVisible)
  const toggle = useUIStore(state => state.toggleLeftSidebar)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          onClick={toggle}
          variant="ghost"
          size="icon"
          className={toolbarButtonClass}
          aria-label={visible ? 'Hide sidebar' : 'Show sidebar'}
          data-testid="toggle-left-sidebar"
        >
          <PanelLeft />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {visible ? 'Hide' : 'Show'} Sidebar
        <ShortcutHint action="toggle_left_sidebar" />
      </TooltipContent>
    </Tooltip>
  )
}

/** The file browser panel belongs to the window, not to one view. Home has
 * nothing to browse and hides it, so the toggle is disabled there rather than
 * showing "pressed" over an empty space. */
function FileBrowserToggle() {
  const isHomeActive = useIsHomeActive()
  const fileBrowserVisible =
    useUIStore(state => state.fileBrowserVisible) && !isHomeActive
  const toggleFileBrowser = useUIStore(state => state.toggleFileBrowser)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          onClick={toggleFileBrowser}
          disabled={isHomeActive}
          variant="ghost"
          size="icon"
          className={cn(
            toolbarButtonClass,
            fileBrowserVisible && 'bg-foreground/10 text-foreground'
          )}
          aria-pressed={fileBrowserVisible}
          aria-label={
            fileBrowserVisible ? 'Hide file browser' : 'Show file browser'
          }
          data-testid="toggle-file-browser"
        >
          <FolderTree />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {fileBrowserVisible ? 'Hide' : 'Show'} File Browser
        <ShortcutHint action="toggle_file_browser" />
      </TooltipContent>
    </Tooltip>
  )
}

function NavigationButtons() {
  const canGoBack = useNavigationHistoryStore(state => state.index > 0)
  const canGoForward = useNavigationHistoryStore(
    state => state.index < state.entries.length - 1
  )
  return (
    <div className="flex items-center">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            onClick={goBack}
            disabled={!canGoBack}
            variant="ghost"
            size="icon"
            className={toolbarButtonClass}
            aria-label="Go back"
            data-testid="navigate-back"
          >
            <ChevronLeft />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Back
          <ShortcutHint action="navigate_back" />
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            onClick={goForward}
            disabled={!canGoForward}
            variant="ghost"
            size="icon"
            className={toolbarButtonClass}
            aria-label="Go forward"
            data-testid="navigate-forward"
          >
            <ChevronRight />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Forward
          <ShortcutHint action="navigate_forward" />
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

/**
 * Which remote instance this window drives.
 *
 * The toolbar's own, independent of the view on screen. The remote name used to
 * live only in the window title, and a view that fills the title slot hides
 * that — so a remote window looked exactly like the local one. The native
 * title is no help either: the unified toolbar hides it.
 */
function RemoteInstanceBadge() {
  const remote = useActiveRemoteConnection()
  if (!remote) return null

  let host = remote.url
  try {
    host = new URL(remote.url).host
  } catch {
    // Show the raw URL rather than nothing.
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          data-testid="remote-instance-badge"
          aria-label={`Remote instance ${remote.name}`}
          className="ml-1.5 flex min-w-0 max-w-[12rem] shrink-0 items-center gap-1 rounded-md border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 text-xs font-medium text-sky-700 dark:text-sky-300"
        >
          <Server className="size-3 shrink-0" aria-hidden />
          <span className="truncate @max-[520px]:hidden">{remote.name}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent>
        Remote instance {remote.name} · {host}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * The toolbar above the main column. Its title, chips, actions and search
 * come from the view on screen (`ToolbarContent`); without one it shows
 * `fallbackTitle`.
 */
export function WindowToolbar({ fallbackTitle }: { fallbackTitle: string }) {
  const zenMode = useUIStore(state => state.zenMode)
  const toggleZenMode = useUIStore(state => state.toggleZenMode)
  const sidebarVisible = useUIStore(state => state.leftSidebarVisible)
  const hasOwner = useToolbarHasOwner()
  const titleRef = useToolbarSlotRef('title')
  const subtitleRef = useToolbarSlotRef('subtitle')
  const chipsRef = useToolbarSlotRef('chips')
  const actionsRef = useToolbarSlotRef('actions')
  const searchRef = useToolbarSlotRef('search')

  const native = isNativeApp()
  const sidebarShown = sidebarVisible && !zenMode
  const trafficLightInset = native && isClientMacOS && !sidebarShown
  // Only the bar and its spacers drag: Tauri ignores the attribute on children.
  const drag = native ? { 'data-tauri-drag-region': true } : {}

  return (
    <div
      {...drag}
      data-testid="window-toolbar"
      className="@container relative z-50 flex h-[var(--titlebar-height)] w-full shrink-0 items-center gap-1 border-b border-border/60 bg-background px-2"
    >
      {trafficLightInset && (
        <div {...drag} className={cn('h-full shrink-0', TRAFFIC_LIGHT_INSET)} />
      )}
      {!sidebarShown && !zenMode && (
        <>
          <SidebarToggleButton />
          <div className="mx-1 h-4 w-px bg-border" />
        </>
      )}
      {!zenMode && <NavigationButtons />}

      {/* Shown in zen too: knowing which machine a window drives is never chrome. */}
      <RemoteInstanceBadge />

      <div
        {...drag}
        className="ml-1.5 flex min-w-0 max-w-[16rem] shrink-0 flex-col justify-center leading-tight"
      >
        {/* The slot stays empty for its portal; React must not render into a
            node a portal also writes to. */}
        {!hasOwner && (
          <div className="truncate text-[0.9375rem] font-bold text-foreground">
            {fallbackTitle}
          </div>
        )}
        <div
          ref={titleRef}
          data-testid="window-toolbar-title"
          className="truncate text-[0.9375rem] font-bold text-foreground empty:hidden"
        />
        <div
          ref={subtitleRef}
          className="truncate text-[0.6875rem] text-muted-foreground empty:hidden @max-[520px]:hidden"
        />
      </div>

      {!zenMode && (
        <div
          ref={chipsRef}
          className="ml-2 flex min-w-0 shrink items-center gap-1.5 overflow-hidden @max-[620px]:hidden"
        />
      )}

      <div {...drag} className="h-full min-w-4 flex-1" />

      {zenMode ? (
        <>
          <UnreadBell />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={toggleZenMode}
                variant="ghost"
                size="icon"
                className={toolbarButtonClass}
                aria-label="Exit zen mode"
                data-testid="toggle-zen-mode"
              >
                <Minimize2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Exit zen mode
              <ShortcutHint action="toggle_zen_mode" />
            </TooltipContent>
          </Tooltip>
        </>
      ) : (
        <>
          <FileBrowserToggle />
          <div
            ref={actionsRef}
            // Text labels of the view's buttons (data-toolbar-label) give way
            // first when the toolbar runs short.
            className="flex shrink-0 items-center gap-0.5 @max-[1000px]:[&_[data-toolbar-label]]:hidden"
          />
          <div ref={searchRef} className="ml-1 flex shrink-0 items-center" />
        </>
      )}

      {native && isClientLinux && <LinuxWindowControls />}
    </div>
  )
}
