import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useClearSessionHistory } from '@/services/chat'
import { useChatStore } from '@/store/chat-store'

export interface ClearContextTarget {
  worktreeId: string
  worktreePath: string
  sessionId: string
}

const CLEAR_CONTEXT_REQUESTED_EVENT = 'clear-session-context-requested'

/**
 * Ask the user to confirm before clearing a session's history. Clearing
 * deletes the transcript and the backend resume id, so it cannot be undone.
 */
export function requestClearSessionContext(target: ClearContextTarget) {
  window.dispatchEvent(
    new CustomEvent<ClearContextTarget>(CLEAR_CONTEXT_REQUESTED_EVENT, {
      detail: target,
    })
  )
}

export function ClearContextConfirmDialog() {
  const [target, setTarget] = useState<ClearContextTarget | null>(null)
  const clearSessionHistory = useClearSessionHistory()

  useEffect(() => {
    const handleRequest = (event: Event) => {
      setTarget((event as CustomEvent<ClearContextTarget>).detail)
    }
    window.addEventListener(CLEAR_CONTEXT_REQUESTED_EVENT, handleRequest)
    return () =>
      window.removeEventListener(CLEAR_CONTEXT_REQUESTED_EVENT, handleRequest)
  }, [])

  const handleConfirm = () => {
    if (!target || clearSessionHistory.isPending) return
    if (useChatStore.getState().isSending(target.sessionId)) {
      toast.info(
        'Wait for the current session to finish before clearing context.'
      )
      return
    }
    clearSessionHistory.mutate(target, {
      onSuccess: () =>
        window.dispatchEvent(new CustomEvent('focus-chat-input')),
    })
  }

  return (
    <AlertDialog
      open={target !== null}
      onOpenChange={open => {
        if (!open) setTarget(null)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Clear context?</AlertDialogTitle>
          <AlertDialogDescription>
            This deletes the chat history of this session and starts a new
            conversation with the model. You cannot undo this.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            Clear Context
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
