import { useEffect, useState } from 'react'
import {
  ArrowDownCircle,
  Ellipsis,
  Github,
  Globe,
  Settings,
  Tag,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useCommandContext } from '@/lib/commands'
import { isNativeApp } from '@/lib/environment'
import { openExternal } from '@/lib/platform'
import { FALLBACK_APP_VERSION } from '@/lib/app-version'
import { REPO_URL, releaseUrlForVersion } from '@/lib/release-url'
import { UnreadBell } from '@/components/unread/UnreadBell'
import { UsagePopover } from '@/components/titlebar/UsagePopover'
import { RemoteConnectionsDialog } from '@/components/remote/RemoteConnectionsDialog'
import {
  CliUpdatesIndicator,
  ServerUpdateIndicator,
  UpdateIndicator,
  useHasPendingUpdate,
} from '@/components/titlebar/update-indicators'
import {
  toolbarButtonClass,
  useShortcutLabel,
} from '@/components/toolbar/WindowToolbar'

function useAppVersion(): string {
  const [version, setVersion] = useState(FALLBACK_APP_VERSION)
  useEffect(() => {
    if (!isNativeApp()) return
    import('@tauri-apps/api/app')
      .then(({ getVersion }) => getVersion())
      .then(setVersion)
      .catch(() => setVersion(FALLBACK_APP_VERSION))
  }, [])
  return version
}

/** One item for every pending update: this app, the host, the CLIs. Each row
 * is the existing indicator with its own action. */
export function UpdatesButton() {
  const hasUpdate = useHasPendingUpdate()
  if (!hasUpdate) return null
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Updates"
              data-testid="sidebar-updates"
              className={`relative ${toolbarButtonClass}`}
            >
              <ArrowDownCircle />
              <span className="absolute right-1 top-1 size-1.5 rounded-full bg-primary" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Updates</TooltipContent>
      </Tooltip>
      <PopoverContent
        side="top"
        align="start"
        className="flex w-auto flex-col items-start gap-1.5 p-2"
      >
        <UpdateIndicator />
        <ServerUpdateIndicator />
        <CliUpdatesIndicator />
      </PopoverContent>
    </Popover>
  )
}

function MoreMenu() {
  const version = useAppVersion()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="More"
          data-testid="sidebar-more"
          className={toolbarButtonClass}
        >
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end">
        <DropdownMenuItem
          onSelect={() => openExternal(REPO_URL)}
        >
          <Github />
          GitHub
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => openExternal('https://splitkick.app')}
        >
          <Globe />
          Website
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => openExternal(releaseUrlForVersion(version))}
        >
          <Tag />
          Release notes
          <span className="ml-auto pl-4 text-xs text-muted-foreground">
            v{version}
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Bottom of the sidebar: app-level items that belong to no single view. */
export function SidebarFooter() {
  const commandContext = useCommandContext()
  const settingsShortcut = useShortcutLabel('open_preferences')
  return (
    <div
      data-testid="sidebar-footer"
      className="flex h-10 shrink-0 items-center gap-0.5 border-t border-border/60 px-2"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            onClick={commandContext.openPreferences}
            variant="ghost"
            size="icon"
            aria-label="Settings"
            className={toolbarButtonClass}
          >
            <Settings />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          Settings
          {isNativeApp() && (
            <kbd className="ml-1 text-[0.625rem] opacity-60">
              {settingsShortcut}
            </kbd>
          )}
        </TooltipContent>
      </Tooltip>
      {isNativeApp() && <RemoteConnectionsDialog />}
      <UsagePopover />
      <div className="flex-1" />
      <UpdatesButton />
      <UnreadBell />
      <MoreMenu />
    </div>
  )
}
