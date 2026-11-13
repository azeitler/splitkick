import { toast } from 'sonner'
import { moveSession } from '@/lib/session-move'

/**
 * `moveSession` with a progress toast, for the Move to submenu and the Move
 * Session dialog.
 */
export function moveSessionWithToast(
  sessionId: string,
  targetWorktreeId: string,
  targetName: string
): void {
  const toastId = toast.loading(`Moving session to ${targetName}…`)
  moveSession(sessionId, targetWorktreeId)
    .then(() => {
      toast.success(`Moved session to ${targetName}`, { id: toastId })
    })
    .catch(error => {
      const message = error instanceof Error ? error.message : String(error)
      toast.error(`Failed to move session: ${message}`, { id: toastId })
    })
}
