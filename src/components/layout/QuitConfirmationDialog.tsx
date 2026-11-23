import { useState, useEffect } from 'react'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { isNativeApp } from '@/lib/environment'
import { logger } from '@/lib/logger'

async function handleQuitAnyway() {
  if (!isNativeApp()) return
  try {
    const { destroyAppWindow } = await import('@/lib/window-close')
    await destroyAppWindow()
  } catch (error) {
    logger.error('Failed to destroy window', { error })
  }
}

/**
 * Dialog that appears when user tries to quit while sessions are running.
 * Only shown in production mode (dev mode allows immediate quit).
 *
 * Listens for the 'quit-confirmation-requested' custom event dispatched
 * by useNativeWindowCloseGuard / window-close when running sessions are detected.
 */
export function QuitConfirmationDialog() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const handleQuitRequest = () => {
      setOpen(true)
    }

    window.addEventListener('quit-confirmation-requested', handleQuitRequest)
    return () => {
      window.removeEventListener(
        'quit-confirmation-requested',
        handleQuitRequest
      )
    }
  }, [])

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      title={<>Sessions are still running</>}
      description={
        <>
          One or more sessions are actively processing. Quitting now will
          interrupt them.
        </>
      }
      confirmLabel={'Quit Anyway'}
      onConfirm={handleQuitAnyway}
    />
  )
}
