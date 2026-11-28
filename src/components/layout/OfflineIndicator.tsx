import { useEffect, useSyncExternalStore } from 'react'
import { WifiOff } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useBackendOffline, useModelsOffline } from '@/lib/backend-online'

export type OfflineReason = 'backend' | 'models'

export const OFFLINE_TEXT: Record<OfflineReason, string> = {
  backend: 'Offline. Reconnecting…',
  models: 'No internet. The models cannot be reached.',
}

const SHORT_TEXT: Record<OfflineReason, string> = {
  backend: 'Offline',
  models: 'No internet',
}

/**
 * What the chat cannot reach: its backend (Web Access, a desktop window on a
 * remote server), or, on a local instance, the internet (the model APIs).
 */
export function useOfflineReason(): OfflineReason | null {
  const backendOffline = useBackendOffline()
  const modelsOffline = useModelsOffline()
  if (backendOffline) return 'backend'
  if (modelsOffline) return 'models'
  return null
}

// How many sidebar footers are on screen. The chat window shows the sign
// itself only when none is (phone, hidden sidebar, zen mode).
let footerCount = 0
const footerListeners = new Set<() => void>()
function setFooterCount(next: number) {
  footerCount = next
  for (const listener of footerListeners) listener()
}
function subscribeFooter(listener: () => void) {
  footerListeners.add(listener)
  return () => footerListeners.delete(listener)
}

/** True while a sidebar footer (with its offline sign) is on screen. */
export function useSidebarFooterShown(): boolean {
  return useSyncExternalStore(subscribeFooter, () => footerCount > 0)
}

/** The offline sign in the sidebar footer, next to the usage item. */
export function SidebarOfflineStatus() {
  const reason = useOfflineReason()

  useEffect(() => {
    setFooterCount(footerCount + 1)
    return () => setFooterCount(footerCount - 1)
  }, [])

  if (!reason) return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="status"
          aria-label={OFFLINE_TEXT[reason]}
          data-testid="offline-indicator"
          data-reason={reason}
          className="ml-1.5 inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-amber-700 dark:text-amber-400"
        >
          <WifiOff className="size-3.5" />
          {SHORT_TEXT[reason]}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{OFFLINE_TEXT[reason]}</TooltipContent>
    </Tooltip>
  )
}
