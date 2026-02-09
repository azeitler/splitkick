import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useUIStore } from '@/store/ui-store'
import { SessionBoardView } from './SessionBoardView'

export function SessionBoardModal() {
  const sessionBoardProjectId = useUIStore(state => state.sessionBoardProjectId)
  const closeSessionBoardModal = useUIStore(
    state => state.closeSessionBoardModal
  )

  const isOpen = sessionBoardProjectId !== null

  return (
    <Dialog
      open={isOpen}
      onOpenChange={open => !open && closeSessionBoardModal()}
    >
      <DialogContent className="!w-screen !h-dvh !max-w-screen !max-h-none !rounded-none sm:!w-[90vw] sm:!max-w-[90vw] sm:!h-[85vh] sm:!max-h-[85vh] sm:!rounded-lg flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Session Board</DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-hidden">
          {sessionBoardProjectId && (
            <SessionBoardView
              projectId={sessionBoardProjectId}
              onSessionClick={() => {
                closeSessionBoardModal()
              }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
