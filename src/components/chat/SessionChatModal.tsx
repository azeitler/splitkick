import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Eye, Maximize2, Terminal, Play, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip'
import { StatusIndicator } from '@/components/ui/status-indicator'
import { GitStatusBadges } from '@/components/ui/git-status-badges'
import { ScrollArea, ScrollBar } from '@/components/ui/scroll-area'
import { useChatStore } from '@/store/chat-store'
import { useTerminalStore } from '@/store/terminal-store'
import { useSessions, useCreateSession } from '@/services/chat'
import { usePreferences } from '@/services/preferences'
import { useWorktree, useProjects, useRunScript } from '@/services/projects'
import {
  useGitStatus,
  gitPush,
  fetchWorktreesStatus,
  triggerImmediateGitPoll,
  performGitPull,
} from '@/services/git-status'
import { isBaseSession } from '@/types/projects'
import type { Session } from '@/types/chat'
import { isNativeApp } from '@/lib/environment'
import { notify } from '@/lib/notifications'
import { toast } from 'sonner'
import { GitDiffModal } from './GitDiffModal'
import type { DiffRequest } from '@/types/git-diff'
import { ChatWindow } from './ChatWindow'
import { ModalTerminalDrawer } from './ModalTerminalDrawer'
import { OpenInButton } from '@/components/open-in/OpenInButton'
import { statusConfig, type SessionStatus } from './session-card-utils'
import { WorktreeDropdownMenu } from '@/components/projects/WorktreeDropdownMenu'
import { LabelModal } from './LabelModal'

interface SessionChatModalProps {
  worktreeId: string
  worktreePath: string
  isOpen: boolean
  onClose: () => void
  onOpenFullView: () => void
}

function getSessionStatus(session: Session, storeState: {
  sendingSessionIds: Record<string, boolean>
  executionModes: Record<string, string>
  reviewingSessions: Record<string, boolean>
}): SessionStatus {
  const isSending = storeState.sendingSessionIds[session.id]
  const executionMode = storeState.executionModes[session.id]
  const isReviewing = storeState.reviewingSessions[session.id] || !!session.review_results

  if (isSending) {
    if (executionMode === 'plan') return 'planning'
    if (executionMode === 'yolo') return 'yoloing'
    return 'vibing'
  }

  if (session.waiting_for_input) {
    return 'waiting'
  }

  if (isReviewing) return 'review'
  return 'idle'
}

export function SessionChatModal({
  worktreeId,
  worktreePath,
  isOpen,
  onClose,
  onOpenFullView,
}: SessionChatModalProps) {
  const { data: sessionsData } = useSessions(worktreeId || null, worktreePath || null)
  const sessions = sessionsData?.sessions ?? []
  const { data: preferences } = usePreferences()
  const { data: runScript } = useRunScript(worktreePath)
  const canvasOnlyMode = preferences?.canvas_only_mode ?? false
  const createSession = useCreateSession()

  // Active session from store
  const activeSessionId = useChatStore(state => state.activeSessionIds[worktreeId])
  const currentSessionId = activeSessionId ?? sessions[0]?.id ?? null
  const currentSession = sessions.find(s => s.id === currentSessionId) ?? null

  // Store state for tab status indicators
  const sendingSessionIds = useChatStore(state => state.sendingSessionIds)
  const executionModes = useChatStore(state => state.executionModes)
  const reviewingSessions = useChatStore(state => state.reviewingSessions)
  const storeState = { sendingSessionIds, executionModes, reviewingSessions }

  // Git status for header badges
  const { data: worktree } = useWorktree(worktreeId)
  const { data: projects } = useProjects()
  const project = worktree
    ? projects?.find(p => p.id === worktree.project_id)
    : null
  const isBase = worktree ? isBaseSession(worktree) : false
  const { data: gitStatus } = useGitStatus(worktreeId)
  const behindCount =
    gitStatus?.behind_count ?? worktree?.cached_behind_count ?? 0
  const unpushedCount =
    gitStatus?.unpushed_count ?? worktree?.cached_unpushed_count ?? 0
  const uncommittedAdded =
    gitStatus?.uncommitted_added ?? worktree?.cached_uncommitted_added ?? 0
  const uncommittedRemoved =
    gitStatus?.uncommitted_removed ?? worktree?.cached_uncommitted_removed ?? 0
  const branchDiffAdded =
    gitStatus?.branch_diff_added ?? worktree?.cached_branch_diff_added ?? 0
  const branchDiffRemoved =
    gitStatus?.branch_diff_removed ?? worktree?.cached_branch_diff_removed ?? 0
  const defaultBranch = project?.default_branch ?? 'main'

  const [diffRequest, setDiffRequest] = useState<DiffRequest | null>(null)

  const hasSetActiveRef = useRef<string | null>(null)

  // Set active session synchronously before paint
  useLayoutEffect(() => {
    if (isOpen && currentSessionId && hasSetActiveRef.current !== currentSessionId) {
      const { setActiveSession } = useChatStore.getState()
      setActiveSession(worktreeId, currentSessionId)
      hasSetActiveRef.current = currentSessionId
    }
  }, [isOpen, currentSessionId, worktreeId])

  // Reset refs when modal closes
  useEffect(() => {
    if (!isOpen) {
      hasSetActiveRef.current = null
    }
  }, [isOpen])

  // Label modal state
  const [labelModalOpen, setLabelModalOpen] = useState(false)
  const currentLabel = useChatStore(state =>
    currentSessionId ? state.sessionLabels[currentSessionId] ?? null : null
  )

  // Listen for toggle-session-label event (CMD+S)
  useEffect(() => {
    if (!isOpen) return
    const handler = () => setLabelModalOpen(true)
    window.addEventListener('toggle-session-label', handler)
    return () => window.removeEventListener('toggle-session-label', handler)
  }, [isOpen])

  const handleClose = useCallback(() => {
    onClose()
  }, [onClose])

  const handleOpenFullView = useCallback(() => {
    onOpenFullView()
  }, [onOpenFullView])

  const handleTabClick = useCallback(
    (sessionId: string) => {
      const { setActiveSession } = useChatStore.getState()
      setActiveSession(worktreeId, sessionId)
    },
    [worktreeId]
  )

  const handleCreateSession = useCallback(() => {
    createSession.mutate(
      { worktreeId, worktreePath },
      {
        onSuccess: (newSession) => {
          const { setActiveSession } = useChatStore.getState()
          setActiveSession(worktreeId, newSession.id)
        },
      }
    )
  }, [worktreeId, worktreePath, createSession])

  // Sorted sessions for tab order (waiting → review → idle)
  const sortedSessions = useMemo(() => {
    const priority: Record<string, number> = { waiting: 0, permission: 0, review: 1 }
    return [...sessions].sort((a, b) => {
      const pa = priority[getSessionStatus(a, storeState)] ?? 2
      const pb = priority[getSessionStatus(b, storeState)] ?? 2
      return pa - pb
    })
  }, [sessions, storeState])

  // CMD+LEFT/RIGHT to switch between session tabs
  useEffect(() => {
    if (!isOpen || sortedSessions.length <= 1) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.metaKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return

      e.preventDefault()
      e.stopPropagation()

      const currentIndex = sortedSessions.findIndex(s => s.id === currentSessionId)
      if (currentIndex === -1) return

      const newIndex = e.key === 'ArrowRight'
        ? (currentIndex + 1) % sortedSessions.length
        : (currentIndex - 1 + sortedSessions.length) % sortedSessions.length

      const target = sortedSessions[newIndex]
      if (!target) return
      const { setActiveSession } = useChatStore.getState()
      setActiveSession(worktreeId, target.id)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, sortedSessions, currentSessionId, worktreeId])

  const handlePull = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      await performGitPull({
        worktreeId,
        worktreePath,
        baseBranch: defaultBranch,
        projectId: project?.id,
      })
    },
    [worktreeId, worktreePath, defaultBranch, project?.id]
  )

  const handlePush = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      const toastId = toast.loading('Pushing changes...')
      try {
        await gitPush(worktreePath, worktree?.pr_number)
        triggerImmediateGitPoll()
        if (project) fetchWorktreesStatus(project.id)
        toast.success('Changes pushed', { id: toastId })
      } catch (error) {
        toast.error(`Push failed: ${error}`, { id: toastId })
      }
    },
    [worktree, worktreePath, project]
  )

  const handleUncommittedDiffClick = useCallback(() => {
    setDiffRequest({
      type: 'uncommitted',
      worktreePath,
      baseBranch: defaultBranch,
    })
  }, [setDiffRequest, worktreePath, defaultBranch])

  const handleBranchDiffClick = useCallback(() => {
    setDiffRequest({
      type: 'branch',
      worktreePath,
      baseBranch: defaultBranch,
    })
  }, [setDiffRequest, worktreePath, defaultBranch])

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

  if (!isOpen || !worktreeId) return null

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && handleClose()}>
      <DialogContent
        key={worktreeId}
        className="!w-screen !h-dvh !max-w-screen !max-h-none !rounded-none sm:!w-[calc(100vw-48px)] sm:!h-[calc(100vh-48px)] sm:!max-w-[calc(100vw-48px)] sm:!rounded-lg flex flex-col p-0 gap-0 overflow-hidden"
        showCloseButton={false}
      >
        <DialogHeader className="shrink-0 border-b px-4 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 sm:hidden"
                onClick={handleClose}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <DialogTitle className="text-sm font-medium shrink-0">
                {isBase ? 'Base Session' : worktree?.name ?? 'Worktree'}
              </DialogTitle>
              {worktree && project && (
                <WorktreeDropdownMenu worktree={worktree} projectId={project.id} />
              )}
              <GitStatusBadges
                behindCount={behindCount}
                unpushedCount={unpushedCount}
                diffAdded={uncommittedAdded}
                diffRemoved={uncommittedRemoved}
                branchDiffAdded={isBase ? 0 : branchDiffAdded}
                branchDiffRemoved={isBase ? 0 : branchDiffRemoved}
                onPull={handlePull}
                onPush={handlePush}
                onDiffClick={handleUncommittedDiffClick}
                onBranchDiffClick={handleBranchDiffClick}
              />
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {isNativeApp() && (
                <>
                  <OpenInButton worktreePath={worktreePath} branch={worktree?.branch} />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => {
                          const { reviewResults, toggleReviewSidebar } = useChatStore.getState()
                          const hasReviewResults = currentSessionId && (reviewResults[currentSessionId] || currentSession?.review_results)
                          if (hasReviewResults) {
                            if (currentSessionId && !reviewResults[currentSessionId] && currentSession?.review_results) {
                              useChatStore.getState().setReviewResults(currentSessionId, currentSession.review_results)
                            }
                            toggleReviewSidebar()
                          } else {
                            window.dispatchEvent(
                              new CustomEvent('magic-command', { detail: { command: 'review', sessionId: currentSessionId } })
                            )
                          }
                        }}
                      >
                        <Eye className="h-3 w-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Review</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
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
                    </TooltipTrigger>
                    <TooltipContent>Terminal</TooltipContent>
                  </Tooltip>
                  {runScript && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={handleRun}
                        >
                          <Play className="h-3 w-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Run</TooltipContent>
                    </Tooltip>
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
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={handleClose}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* Session tabs */}
        {sessions.length > 0 && (
          <div className="shrink-0 border-b px-2 flex items-center gap-0.5 overflow-x-auto">
            <ScrollArea className="flex-1">
              <div className="flex items-center gap-0.5 py-1">
                {sortedSessions.map(session => {
                  const isActive = session.id === currentSessionId
                  const status = getSessionStatus(session, storeState)
                  const config = statusConfig[status]
                  return (
                    <button
                      key={session.id}
                      onClick={() => handleTabClick(session.id)}
                      className={cn(
                        'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors whitespace-nowrap',
                        isActive
                          ? 'bg-muted text-foreground font-medium'
                          : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                      )}
                    >
                      <StatusIndicator
                        status={config.indicatorStatus}
                        variant={config.indicatorVariant}
                        className="h-1.5 w-1.5"
                      />
                      {session.name}
                    </button>
                  )
                })}
              </div>
              <ScrollBar orientation="horizontal" className="h-1" />
            </ScrollArea>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 shrink-0"
                  onClick={handleCreateSession}
                >
                  <Plus className="h-3 w-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>New session</TooltipContent>
            </Tooltip>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-hidden">
          {currentSessionId && (
            <ChatWindow
              key={currentSessionId}
              isModal
              worktreeId={worktreeId}
              worktreePath={worktreePath}
            />
          )}
        </div>

        {/* Terminal side drawer */}
        {isNativeApp() && (
          <ModalTerminalDrawer
            worktreeId={worktreeId}
            worktreePath={worktreePath}
          />
        )}
        {diffRequest && (
          <GitDiffModal
            diffRequest={diffRequest}
            onClose={() => setDiffRequest(null)}
          />
        )}
      </DialogContent>
      <LabelModal
        isOpen={labelModalOpen}
        onClose={() => setLabelModalOpen(false)}
        sessionId={currentSessionId}
        currentLabel={currentLabel}
      />
    </Dialog>
  )
}
