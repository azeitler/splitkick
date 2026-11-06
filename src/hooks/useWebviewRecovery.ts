import { useEffect } from 'react'
import { toast } from 'sonner'
import { PRODUCT_NAME } from '@/lib/build-info'
import { copyToClipboard } from '@/lib/clipboard'
import { isNativeApp } from '@/lib/environment'
import { logger } from '@/lib/logger'
import { listenMenu } from '@/lib/transport'
import { takeWebviewRecovery } from '@/lib/webview-liveness'

/**
 * After the desktop shell reloaded this window (content process crash or no
 * answer after a suspend, #97), say so and offer the details. The persisted
 * UI state has already put the user back on their session. Also confirms
 * Help → Copy Memory Report.
 */
export function useWebviewRecovery(): void {
  useEffect(() => {
    if (!isNativeApp()) return
    let disposed = false
    void takeWebviewRecovery().then(note => {
      if (!note || disposed) return
      logger.info('Webview recovered', { reason: note.reason })
      toast.warning(`${PRODUCT_NAME} recovered from a display crash`, {
        description: note.reason,
        duration: 15_000,
        action: {
          label: 'Copy details',
          onClick: () => {
            void copyToClipboard(note.details).then(
              () => toast.success('Details copied'),
              error => toast.error(`Copy failed: ${error}`)
            )
          },
        },
      })
    })

    const unlisten = listenMenu<boolean>('memory-report-copied', copied => {
      if (copied) toast.success('Memory report copied')
      else toast.error('Copy Memory Report failed, see the log')
    })
    return () => {
      disposed = true
      void unlisten.then(stop => stop())
    }
  }, [])
}
