import { WifiOff } from 'lucide-react'
import { useBackendOffline, useModelsOffline } from '@/lib/backend-online'

/**
 * A small, always visible sign while something the chat needs is not
 * reachable: the backend (Web Access, a desktop window on a remote server),
 * or the internet of a local instance (the model APIs). It sits below the
 * title bar, above dialogs, and lets clicks pass through.
 */
export function OfflineIndicator() {
  const backendOffline = useBackendOffline()
  const modelsOffline = useModelsOffline()
  if (!backendOffline && !modelsOffline) return null
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="offline-indicator"
      className="pointer-events-none fixed inset-x-0 z-[110] flex justify-center px-2"
      style={{ top: 'calc(var(--titlebar-height, 2.75rem) + 0.5rem)' }}
    >
      <div className="flex items-center gap-1.5 rounded-full border border-amber-500/50 bg-amber-100 px-3 py-1 text-xs font-medium text-amber-950 shadow-md dark:bg-amber-950 dark:text-amber-100">
        <WifiOff className="size-3.5" />
        {backendOffline
          ? 'Offline. Reconnecting…'
          : 'No internet. The models cannot be reached.'}
      </div>
    </div>
  )
}
