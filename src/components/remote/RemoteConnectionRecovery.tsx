import { useEffect } from 'react'
import { ServerOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  LOCAL_CONNECTION_ID,
  isConnectionWindow,
  markConnectionSwitch,
  selectConnection,
  type RemoteConnection,
} from '@/lib/remote-connections'
import { focusMainWindow } from '@/lib/connection-windows'
import { destroyAppWindow } from '@/lib/window-close'
import { dismissTransientUi } from '@/lib/dismiss-transient-ui'
import { isSsoProxyMessage } from '@/lib/remote-version'

/** A reload keeps the query string, so a connection window stays pinned to
 * `?connection=<id>` across every retry. */
function reloadPage() {
  window.location.reload()
}

export function RemoteConnectionRecovery({
  connection,
  error,
}: {
  connection: RemoteConnection
  error: string
}) {
  // Drop open context menus / settings / dialogs so they cannot sit above
  // this surface or leave body pointer-events locked (issue #623).
  useEffect(() => {
    dismissTransientUi()
  }, [])

  // An SSO login proxy rejects the desktop client every time, so the usual
  // auto-retry can only loop. Leave the manual Retry button available.
  const permanent = isSsoProxyMessage(error)
  const connectionWindow = isConnectionWindow()

  useEffect(() => {
    if (permanent) return
    const retryTimer = window.setInterval(reloadPage, 10_000)
    return () => window.clearInterval(retryTimer)
  }, [permanent])

  return (
    // z-[100] sits above dialogs (70) and menus/popovers (80).
    <div className="fixed inset-x-0 bottom-0 top-8 z-[100] flex items-center justify-center bg-background">
      <div className="mx-4 w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
        <div className="flex items-center gap-2">
          <ServerOff className="size-5 text-destructive" />
          <h2 className="font-semibold">
            Couldn&apos;t connect to {connection.name}
          </h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{error}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {connection.url}
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button onClick={reloadPage}>Retry</Button>
          <Button
            variant="outline"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent('open-remote-connections', {
                  detail: { id: connection.id },
                })
              )
            }
          >
            Edit connection
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              // A connection window cannot become the local one — local lives
              // in the main window. Give up on this remote and close.
              if (isConnectionWindow()) {
                void focusMainWindow().finally(() => void destroyAppWindow())
                return
              }
              markConnectionSwitch()
              selectConnection(LOCAL_CONNECTION_ID)
              reloadPage()
            }}
          >
            {connectionWindow ? 'Close window' : 'Switch to Local'}
          </Button>
        </div>
      </div>
    </div>
  )
}
