import { useState, useEffect, useCallback } from 'react'
import { ArrowUpCircle, Download, X } from 'lucide-react'
import { toast } from 'sonner'
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
import { useUIStore } from '@/store/ui-store'
import type { PendingCliUpdate } from '@/store/ui-store'
import { CLI_DISPLAY_NAMES, resolveCliPathUpdateAction } from '@/lib/cli-update'
import { applyServerUpdate } from '@/hooks/useServerUpdateCheck'
import { hostUpdateBadge, hostUpdateLabel } from '@/lib/host-update-badge'

/** Whether any update waits: this app, the connected host, or a CLI. */
export function useHasPendingUpdate(): boolean {
  return useUIStore(
    state =>
      !!state.pendingUpdateVersion ||
      !!state.updateReadyVersion ||
      state.isUpdateInstalling ||
      !!state.pendingServerUpdate ||
      state.availableCliUpdates.length > 0
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

/**
 * Update waiting on the **host** this client is connected to — never this
 * app's own update, which is `UpdateIndicator`. A desktop host installs with
 * its own updater, so the badge walks the install phases and ends on "Restart
 * host", the confirmation the host cannot ask for itself.
 */
export function ServerUpdateIndicator() {
  const pending = useUIStore(state => state.pendingServerUpdate)
  if (!pending) return null

  const { label, tooltip, busy } = hostUpdateBadge(pending)

  const handleClick = () => {
    if (!pending.canUpdate) {
      toast.info(
        `${hostUpdateLabel(pending.channel)} ${pending.latestVersion} is available`,
        {
          id: 'server-update-available',
          description:
            pending.reason ||
            'This host cannot self-update. Replace the binary or image manually.',
          duration: 12_000,
        }
      )
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
          disabled={busy}
          data-testid="host-update-indicator"
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
