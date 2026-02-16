import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Archive, ArrowLeft, Eye, EyeOff, Maximize2, Pencil, Tag, Terminal, Play, Plus, Trash2, X } from 'lucide-react'
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
import { useSessions, useCreateSession, useRenameSession } from '@/services/chat'
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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { WorktreeDropdownMenu } from '@/components/projects/WorktreeDropdownMenu'
import { LabelModal } from './LabelModal'
import { useSessionArchive } from './hooks/useSessionArchive'

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

  // Horizontal scroll on session tabs
  const modalTabScrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const viewport = modalTabScrollRef.current
    if (!viewport) return

    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY !== 0) {
        e.preventDefault()
        viewport.scrollLeft += e.deltaY
      }
    }

    viewport.addEventListener('wheel', handleWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', handleWheel)
  }, [sessions.length])

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
  const [labelTargetSessionId, setLabelTargetSessionId] = useState<string | null>(null)
  const labelSessionId = labelTargetSessionId ?? currentSessionId
  const currentLabel = useChatStore(state =>
    labelSessionId ? state.sessionLabels[labelSessionId] ?? null : null
  )

  // Rename session state
  const renameSession = useRenameSession()
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  // Delay rename start so the input renders after the context menu fully closes
  // (Radix restores focus to the trigger on close, which would steal focus from the input)
  const handleStartRename = useCallback((sessionId: string, currentName: string) => {
    setRenameValue(currentName)
    setTimeout(() => setRenamingSessionId(sessionId), 200)
  }, [])

  const handleRenameSubmit = useCallback((sessionId: string) => {
    const newName = renameValue.trim()
    if (newName && newName !== sessions.find(s => s.id === sessionId)?.name) {
      renameSession.mutate({ worktreeId, worktreePath, sessionId, newName })
    }
    setRenamingSessionId(null)
  }, [renameValue, worktreeId, worktreePath, renameSession, sessions])

  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent, sessionId: string) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleRenameSubmit(sessionId)
    } else if (e.key === 'Escape') {
      setRenamingSessionId(null)
    }
  }, [handleRenameSubmit])

  const renameInputRef = useCallback((node: HTMLInputElement | null) => {
    if (node) {
      node.focus()
      node.select()
    }
  }, [])

  // Session archive/delete handlers
  const { handleArchiveSession, handleDeleteSession } = useSessionArchive({
    worktreeId,
    worktreePath,
    sessions,
    worktree: worktree ?? null,
    project: project ?? null,
    removalBehavior: preferences?.removal_behavior,
  })

  // CMD+W: close the active session tab, or close modal if last tab
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: Event) => {
      e.stopImmediatePropagation()
      const activeSessions = sessions.filter(s => !s.archived_at)
      if (activeSessions.length <= 1) {
        onClose()
      } else if (currentSessionId) {
        handleArchiveSession(currentSessionId)
      }
    }
    window.addEventListener('close-session-or-worktree', handler, { capture: true })
    return () => window.removeEventListener('close-session-or-worktree', handler, { capture: true })
  }, [isOpen, sessions, currentSessionId, onClose, handleArchiveSession])

  // Listen for toggle-session-label event (CMD+S)
  useEffect(() => {
    if (!isOpen) return
    const handler = () => {
      setLabelTargetSessionId(null)
      setLabelModalOpen(true)
    }
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

  // Listen for switch-session events from the global keybinding system (OPT+CMD+LEFT/RIGHT)
  useEffect(() => {
    if (!isOpen || sortedSessions.length <= 1) return

    const handleSwitchSession = (e: Event) => {
      const detail = (e as CustomEvent).detail
      let newIndex: number

      if (detail?.index !== undefined) {
        // CMD+1–9: switch by index directly
        if (detail.index >= sortedSessions.length) return
        newIndex = detail.index
      } else {
        const direction = detail?.direction as 'next' | 'previous'
        if (!direction) return
        const currentIndex = sortedSessions.findIndex(s => s.id === currentSessionId)
        if (currentIndex === -1) return
        newIndex = direction === 'next'
          ? (currentIndex + 1) % sortedSessions.length
          : (currentIndex - 1 + sortedSessions.length) % sortedSessions.length
      }

      const target = sortedSessions[newIndex]
      if (!target) return
      const { setActiveSession } = useChatStore.getState()
      setActiveSession(worktreeId, target.id)
    }

    window.addEventListener('switch-session', handleSwitchSession)
    return () => window.removeEventListener('switch-session', handleSwitchSession)
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
            <ScrollArea className="flex-1" viewportRef={modalTabScrollRef}>
              <div className="flex items-center gap-0.5 py-1">
                {sortedSessions.map((session, idx) => {
                  const isActive = session.id === currentSessionId
                  const status = getSessionStatus(session, storeState)
                  const config = statusConfig[status]
                  const sessionLabel = useChatStore.getState().sessionLabels[session.id]
                  return (
                    <ContextMenu key={session.id}>
                      <ContextMenuTrigger asChild>
                        <button
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
                          {idx < 9 && (
                            <kbd className="shrink-0 rounded border border-border/50 px-1 py-px text-[9px] font-medium leading-none text-muted-foreground/70">
                              ⌘{idx + 1}
                            </kbd>
                          )}
                          {renamingSessionId === session.id ? (
                            <input
                              ref={renameInputRef}
                              type="text"
                              value={renameValue}
                              onChange={e => setRenameValue(e.target.value)}
                              onBlur={() => handleRenameSubmit(session.id)}
                              onKeyDown={e => handleRenameKeyDown(e, session.id)}
                              onClick={e => e.stopPropagation()}
                              className="w-full min-w-0 bg-transparent text-xs outline-none"
                            />
                          ) : (
                            session.name
                          )}
                          {sessions.length > 1 && status === 'idle' && renamingSessionId !== session.id && (
                            <span
                              role="button"
                              onClick={e => {
                                e.stopPropagation()
                                handleArchiveSession(session.id)
                              }}
                              className="ml-0.5 inline-flex items-center rounded opacity-40 transition-opacity hover:opacity-100 hover:bg-muted-foreground/20"
                            >
                              <X className="h-3 w-3" />
                            </span>
                          )}
                        </button>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="w-48">
                        <ContextMenuItem onSelect={() => handleStartRename(session.id, session.name)}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Rename
                        </ContextMenuItem>
                        <ContextMenuItem onSelect={() => {
                          setLabelTargetSessionId(session.id)
                          setLabelModalOpen(true)
                        }}>
                          <Tag className="mr-2 h-4 w-4" />
                          {sessionLabel ? 'Remove Label' : 'Add Label'}
                        </ContextMenuItem>
                        <ContextMenuItem onSelect={() => {
                          const { reviewingSessions, setSessionReviewing } = useChatStore.getState()
                          const isReviewing = reviewingSessions[session.id] || !!session.review_results
                          setSessionReviewing(session.id, !isReviewing)
                        }}>
                          {status === 'review' ? (
                            <>
                              <EyeOff className="mr-2 h-4 w-4" />
                              Mark as Idle
                            </>
                          ) : (
                            <>
                              <Eye className="mr-2 h-4 w-4" />
                              Mark for Review
                            </>
                          )}
                        </ContextMenuItem>
                        <ContextMenuItem onSelect={() => handleArchiveSession(session.id)}>
                          <Archive className="mr-2 h-4 w-4" />
                          Archive Session
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem variant="destructive" onSelect={() => handleDeleteSession(session.id)}>
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete Session
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
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
        onClose={() => {
          setLabelModalOpen(false)
          setLabelTargetSessionId(null)
        }}
        sessionId={labelSessionId}
        currentLabel={currentLabel}
      />
    </Dialog>
  )
}
