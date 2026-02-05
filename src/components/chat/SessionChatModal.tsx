import { useCallback, useEffect, useRef } from 'react'
import { Maximize2, Terminal, Play } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useChatStore } from '@/store/chat-store'
import { useTerminalStore } from '@/store/terminal-store'
import { useSession } from '@/services/chat'
import { usePreferences } from '@/services/preferences'
import { useRunScript } from '@/services/projects'
import { isNativeApp } from '@/lib/environment'
import { notify } from '@/lib/notifications'
import { ChatWindow } from './ChatWindow'
import { ModalTerminalDrawer } from './ModalTerminalDrawer'

interface SessionChatModalProps {
  sessionId: string | null
  worktreeId: string
  worktreePath: string
  isOpen: boolean
  onClose: () => void
  onOpenFullView: () => void
}

export function SessionChatModal({
  sessionId,
  worktreeId,
  worktreePath,
  isOpen,
  onClose,
  onOpenFullView,
}: SessionChatModalProps) {
  const { data: session } = useSession(sessionId, worktreeId, worktreePath)
  const { data: preferences } = usePreferences()
  const { data: runScript } = useRunScript(worktreePath)
  const canvasOnlyMode = preferences?.canvas_only_mode ?? false

  // Store the previous active session to restore on close
  const previousSessionRef = useRef<string | undefined>(undefined)
  const hasSetActiveRef = useRef<string | null>(null)

  // Synchronously set active session before render to avoid race conditions
  // This ensures ChatWindow inside the modal sees the correct session immediately
  // NOTE: We don't set activeWorktree - we pass it as props to ChatWindow instead
  // This prevents navigation away from WorktreeDashboard when opening modals
  if (isOpen && sessionId && hasSetActiveRef.current !== sessionId) {
    const { activeSessionIds, setActiveSession } = useChatStore.getState()
    // Only store previous if this is a new modal open (not a sessionId change)
    if (hasSetActiveRef.current === null) {
      previousSessionRef.current = activeSessionIds[worktreeId]
    }
    // Only set the session, not the worktree (worktree is passed as props)
    setActiveSession(worktreeId, sessionId)
    hasSetActiveRef.current = sessionId
  }

  // Reset refs when modal closes
  useEffect(() => {
    if (!isOpen) {
      hasSetActiveRef.current = null
    }
  }, [isOpen])

  // When modal closes, restore the previous session
  const handleClose = useCallback(() => {
    if (previousSessionRef.current) {
      const { setActiveSession } = useChatStore.getState()
      setActiveSession(worktreeId, previousSessionRef.current)
    }
    onClose()
  }, [worktreeId, onClose])

  const handleOpenFullView = useCallback(() => {
    // Don't restore previous session - keep this one active
    previousSessionRef.current = undefined
    onOpenFullView()
  }, [onOpenFullView])

  const handleRun = useCallback(() => {
    if (!runScript) {
      notify('No run script configured in jean.json', undefined, {
        type: 'error',
      })
      return
    }
    useTerminalStore.getState().startRun(worktreeId, runScript)
    useTerminalStore.getState().setModalTerminalOpen(worktreeId, true)
  }, [worktreeId, runScript])

  if (!sessionId) return null

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && handleClose()}>
      <DialogContent
        className="!w-[calc(100vw-48px)] !h-[calc(100vh-48px)] !max-w-[calc(100vw-48px)] !max-h-none flex flex-col p-0 gap-0 overflow-hidden"
        showCloseButton={false}
      >
        <DialogHeader className="shrink-0 border-b px-4 py-2">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-sm font-medium">
              {session?.name ?? 'Session'}
            </DialogTitle>
            <div className="flex items-center gap-1">
              {isNativeApp() && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                      useTerminalStore
                        .getState()
                        .toggleModalTerminal(worktreeId)
                    }}
                  >
                    <Terminal className="h-3 w-3" />
                  </Button>
                  {runScript && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={handleRun}
                    >
                      <Play className="h-3 w-3" />
                    </Button>
                  )}
                </>
              )}
              {!canvasOnlyMode && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={handleOpenFullView}
                >
                  <Maximize2 className="mr-1 h-3 w-3" />
                  Open Full View
                </Button>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-hidden">
          {/* Key forces ChatWindow remount when sessionId changes, ensuring fresh state */}
          {/* Pass worktreeId/worktreePath as props to avoid setting global store state */}
          <ChatWindow
            key={sessionId}
            isModal
            worktreeId={worktreeId}
            worktreePath={worktreePath}
          />
        </div>

        {/* Terminal side drawer */}
        {isNativeApp() && (
          <ModalTerminalDrawer
            worktreeId={worktreeId}
            worktreePath={worktreePath}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
