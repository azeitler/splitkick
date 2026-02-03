import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'
import {
  useSessions,
  useSendMessage,
  markPlanApproved,
  chatQueryKeys,
  useArchiveSession,
  useCloseSession,
} from '@/services/chat'
import { usePreferences } from '@/services/preferences'
import {
  useWorktree,
  useProjects,
  useArchiveWorktree,
  useCloseBaseSessionClean,
} from '@/services/projects'
import { type Session } from '@/types/chat'
import { isBaseSession } from '@/types/projects'
import { PlanDialog } from './PlanDialog'
import { SessionChatModal } from './SessionChatModal'
import { SessionCard } from './SessionCard'
import {
  type SessionCardData,
  type ChatStoreState,
  computeSessionCardData,
} from './session-card-utils'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'

interface SessionCanvasViewProps {
  worktreeId: string
  worktreePath: string
}

export function SessionCanvasView({
  worktreeId,
  worktreePath,
}: SessionCanvasViewProps) {
  const queryClient = useQueryClient()
  const { data: sessionsData } = useSessions(worktreeId, worktreePath)
  const { data: preferences } = usePreferences()
  const sendMessage = useSendMessage()
  const archiveSession = useArchiveSession()
  const closeSession = useCloseSession()
  const archiveWorktree = useArchiveWorktree()
  const closeBaseSessionClean = useCloseBaseSessionClean()

  // Project and worktree info for title display
  const { data: worktree } = useWorktree(worktreeId)
  const { data: projects } = useProjects()
  const project = worktree
    ? projects?.find(p => p.id === worktree.project_id)
    : null
  const sessionLabel = worktree && isBaseSession(worktree) ? 'base' : worktree?.name

  // Dialog state
  const [planDialogPath, setPlanDialogPath] = useState<string | null>(null)
  const [planDialogContent, setPlanDialogContent] = useState<string | null>(null)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)

  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Keyboard navigation state
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<(HTMLDivElement | null)[]>([])

  // Track session modal open state for magic command keybindings
  useEffect(() => {
    useUIStore.getState().setSessionChatModalOpen(
      !!selectedSessionId,
      selectedSessionId ? worktreeId : null
    )
  }, [selectedSessionId, worktreeId])

  // Listen for open-session-modal event (used when creating new session in canvas-only mode)
  useEffect(() => {
    const handleOpenSessionModal = (e: CustomEvent<{ sessionId: string }>) => {
      setSelectedSessionId(e.detail.sessionId)
    }

    window.addEventListener(
      'open-session-modal',
      handleOpenSessionModal as EventListener
    )
    return () =>
      window.removeEventListener(
        'open-session-modal',
        handleOpenSessionModal as EventListener
      )
  }, [])

  // Listen for focus-canvas-search event
  useEffect(() => {
    const handleFocusSearch = () => searchInputRef.current?.focus()
    window.addEventListener('focus-canvas-search', handleFocusSearch)
    return () => window.removeEventListener('focus-canvas-search', handleFocusSearch)
  }, [])

  // When sessions load for a newly created worktree, auto-open the first session modal
  useEffect(() => {
    console.log('[AUTO-OPEN] Effect triggered:', {
      worktreeId,
      sessionsCount: sessionsData?.sessions?.length ?? 0,
      sessionIds: sessionsData?.sessions?.map(s => s.id) ?? [],
      storeState: [...useUIStore.getState().autoOpenSessionWorktreeIds],
    })

    if (!sessionsData?.sessions?.length) {
      console.log('[AUTO-OPEN] No sessions yet, skipping')
      return
    }

    const shouldAutoOpen =
      useUIStore.getState().consumeAutoOpenSession(worktreeId)
    console.log(
      '[AUTO-OPEN] shouldAutoOpen:',
      shouldAutoOpen,
      'for worktreeId:',
      worktreeId
    )
    if (!shouldAutoOpen) return

    const firstSession = sessionsData.sessions[0]
    console.log('[AUTO-OPEN] Opening first session:', firstSession?.id)
    if (firstSession) {
      setSelectedSessionId(firstSession.id)
    }
  }, [worktreeId, sessionsData?.sessions])

  // Subscribe to status-related state
  const sendingSessionIds = useChatStore(state => state.sendingSessionIds)
  const executingModes = useChatStore(state => state.executingModes)
  const executionModes = useChatStore(state => state.executionModes)
  const activeToolCalls = useChatStore(state => state.activeToolCalls)
  const answeredQuestions = useChatStore(state => state.answeredQuestions)
  const waitingForInputSessionIds = useChatStore(
    state => state.waitingForInputSessionIds
  )
  const reviewingSessions = useChatStore(state => state.reviewingSessions)
  const pendingPermissionDenials = useChatStore(
    state => state.pendingPermissionDenials
  )

  // Actions via getState()
  const {
    setActiveSession,
    setViewingCanvasTab,
    setExecutionMode,
    addSendingSession,
    setSelectedModel,
    setLastSentMessage,
    setError,
    setExecutingMode,
    setSessionReviewing,
    setWaitingForInput,
    clearToolCalls,
    clearStreamingContentBlocks,
    setCanvasSelectedSession,
  } = useChatStore.getState()

  // Compute session card data
  const sessionCards: SessionCardData[] = useMemo(() => {
    const sessions = sessionsData?.sessions ?? []
    const storeState: ChatStoreState = {
      sendingSessionIds,
      executingModes,
      executionModes,
      activeToolCalls,
      answeredQuestions,
      waitingForInputSessionIds,
      reviewingSessions,
      pendingPermissionDenials,
    }
    const cards = sessions.map(session => computeSessionCardData(session, storeState))

    // Filter by search query
    if (!searchQuery.trim()) return cards
    const q = searchQuery.toLowerCase()
    return cards.filter(card => card.session.name?.toLowerCase().includes(q))
  }, [
    sessionsData?.sessions,
    sendingSessionIds,
    executingModes,
    executionModes,
    activeToolCalls,
    answeredQuestions,
    waitingForInputSessionIds,
    reviewingSessions,
    pendingPermissionDenials,
    searchQuery,
  ])

  // Calculate cards per row for vertical navigation
  const getCardsPerRow = useCallback(() => {
    if (cardRefs.current.length < 2) return 1
    const first = cardRefs.current[0]?.getBoundingClientRect()
    const second = cardRefs.current[1]?.getBoundingClientRect()
    if (!first || !second) return 1
    if (Math.abs(first.top - second.top) < 10) {
      let count = 1
      for (let i = 1; i < cardRefs.current.length; i++) {
        const rect = cardRefs.current[i]?.getBoundingClientRect()
        if (rect && Math.abs(rect.top - first.top) < 10) count++
        else break
      }
      return count
    }
    return 1
  }, [])

  // Handle clicking on a session card - open modal
  const handleSessionClick = useCallback((sessionId: string) => {
    setSelectedSessionId(sessionId)
    // Track in store for magic menu
    setCanvasSelectedSession(worktreeId, sessionId)
  }, [worktreeId, setCanvasSelectedSession])

  // Global keyboard navigation for canvas
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if magic modal is open - it handles its own arrow keys
      if (useUIStore.getState().magicModalOpen) return

      if (selectedSessionId) return
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        (document.activeElement as HTMLElement)?.isContentEditable
      ) {
        return
      }

      const total = sessionCards.length
      if (total === 0) return

      if (selectedIndex === null) {
        if (
          ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(e.key)
        ) {
          setSelectedIndex(0)
          // Track in store for magic menu
          const firstSession = sessionCards[0]
          if (firstSession) {
            setCanvasSelectedSession(worktreeId, firstSession.session.id)
          }
          e.preventDefault()
        }
        return
      }

      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault()
          if (selectedIndex < total - 1) {
            const newIndex = selectedIndex + 1
            setSelectedIndex(newIndex)
            const session = sessionCards[newIndex]
            if (session) {
              setCanvasSelectedSession(worktreeId, session.session.id)
            }
          }
          break
        case 'ArrowLeft':
          e.preventDefault()
          if (selectedIndex > 0) {
            const newIndex = selectedIndex - 1
            setSelectedIndex(newIndex)
            const session = sessionCards[newIndex]
            if (session) {
              setCanvasSelectedSession(worktreeId, session.session.id)
            }
          }
          break
        case 'ArrowDown': {
          e.preventDefault()
          const perRow = getCardsPerRow()
          const next = selectedIndex + perRow
          if (next < total) {
            setSelectedIndex(next)
            const session = sessionCards[next]
            if (session) {
              setCanvasSelectedSession(worktreeId, session.session.id)
            }
          }
          break
        }
        case 'ArrowUp': {
          e.preventDefault()
          const perRow = getCardsPerRow()
          const prev = selectedIndex - perRow
          if (prev >= 0) {
            setSelectedIndex(prev)
            const session = sessionCards[prev]
            if (session) {
              setCanvasSelectedSession(worktreeId, session.session.id)
            }
          }
          break
        }
        case 'Enter':
          // Only handle plain Enter (no modifiers) - CMD+Enter is for approve_plan keybinding
          if (e.metaKey || e.ctrlKey) return
          e.preventDefault()
          if (sessionCards[selectedIndex]) {
            handleSessionClick(sessionCards[selectedIndex].session.id)
          }
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    selectedIndex,
    selectedSessionId,
    sessionCards,
    getCardsPerRow,
    handleSessionClick,
    worktreeId,
    setCanvasSelectedSession,
  ])

  // Scroll selected card into view when selection changes
  useEffect(() => {
    if (selectedIndex === null) return
    const card = cardRefs.current[selectedIndex]
    if (card) {
      card.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [selectedIndex])

  // Handle opening full view from modal
  const handleOpenFullView = useCallback(() => {
    if (selectedSessionId) {
      setViewingCanvasTab(worktreeId, false)
      setActiveSession(worktreeId, selectedSessionId)
      setSelectedSessionId(null)
    }
  }, [worktreeId, selectedSessionId, setViewingCanvasTab, setActiveSession])

  // Handle archive session - if last session, archive worktree instead
  const handleArchiveSession = useCallback(
    (sessionId: string) => {
      const activeSessions =
        sessionsData?.sessions.filter(s => !s.archived_at) ?? []

      if (activeSessions.length <= 1 && worktree && project) {
        if (isBaseSession(worktree)) {
          closeBaseSessionClean.mutate({
            worktreeId,
            projectId: project.id,
          })
        } else {
          archiveWorktree.mutate({
            worktreeId,
            projectId: project.id,
          })
        }
      } else {
        archiveSession.mutate({
          worktreeId,
          worktreePath,
          sessionId,
        })
      }
    },
    [
      sessionsData?.sessions,
      worktree,
      project,
      worktreeId,
      worktreePath,
      archiveSession,
      archiveWorktree,
      closeBaseSessionClean,
    ]
  )

  // Handle delete session - if last session, archive worktree instead
  const handleDeleteSession = useCallback(
    (sessionId: string) => {
      const activeSessions =
        sessionsData?.sessions.filter(s => !s.archived_at) ?? []

      if (activeSessions.length <= 1 && worktree && project) {
        if (isBaseSession(worktree)) {
          closeBaseSessionClean.mutate({
            worktreeId,
            projectId: project.id,
          })
        } else {
          archiveWorktree.mutate({
            worktreeId,
            projectId: project.id,
          })
        }
      } else {
        closeSession.mutate({
          worktreeId,
          worktreePath,
          sessionId,
        })
      }
    },
    [
      sessionsData?.sessions,
      worktree,
      project,
      worktreeId,
      worktreePath,
      closeSession,
      archiveWorktree,
      closeBaseSessionClean,
    ]
  )

  // Listen for close-session-or-worktree event to handle CMD+W in canvas view
  useEffect(() => {
    const handleCloseSessionOrWorktree = (e: Event) => {
      if (selectedSessionId) {
        setSelectedSessionId(null)
        return
      }

      if (selectedIndex !== null && sessionCards[selectedIndex]) {
        e.stopImmediatePropagation()
        const sessionId = sessionCards[selectedIndex].session.id
        handleArchiveSession(sessionId)

        const total = sessionCards.length
        if (total <= 1) {
          setSelectedIndex(null)
        } else if (selectedIndex >= total - 1) {
          setSelectedIndex(selectedIndex - 1)
        }
      }
    }

    window.addEventListener('close-session-or-worktree', handleCloseSessionOrWorktree, {
      capture: true,
    })
    return () =>
      window.removeEventListener(
        'close-session-or-worktree',
        handleCloseSessionOrWorktree,
        { capture: true }
      )
  }, [selectedSessionId, selectedIndex, sessionCards, handleArchiveSession])

  // Handle plan approval
  const handlePlanApproval = useCallback(
    (card: SessionCardData) => {
      if (!card.pendingPlanMessageId) return

      const sessionId = card.session.id
      const messageId = card.pendingPlanMessageId

      markPlanApproved(worktreeId, worktreePath, sessionId, messageId)

      queryClient.setQueryData<Session>(
        chatQueryKeys.session(sessionId),
        old => {
          if (!old) return old
          return {
            ...old,
            messages: old.messages.map(msg =>
              msg.id === messageId ? { ...msg, plan_approved: true } : msg
            ),
          }
        }
      )

      setExecutionMode(sessionId, 'build')
      clearToolCalls(sessionId)
      clearStreamingContentBlocks(sessionId)
      setSessionReviewing(sessionId, false)
      setWaitingForInput(sessionId, false)
      // Note: Don't clear pendingPlanMessageId - keep plan accessible after approval

      const model = preferences?.selected_model ?? 'opus'
      const thinkingLevel = preferences?.thinking_level ?? 'off'

      setLastSentMessage(sessionId, 'Approved')
      setError(sessionId, null)
      addSendingSession(sessionId)
      setSelectedModel(sessionId, model)
      setExecutingMode(sessionId, 'build')

      sendMessage.mutate({
        sessionId,
        worktreeId,
        worktreePath,
        message: 'Approved',
        model,
        executionMode: 'build',
        thinkingLevel,
        disableThinkingForMode: true,
      })
    },
    [
      worktreeId,
      worktreePath,
      queryClient,
      preferences,
      sendMessage,
      setExecutionMode,
      clearToolCalls,
      clearStreamingContentBlocks,
      setSessionReviewing,
      setWaitingForInput,
      setLastSentMessage,
      setError,
      addSendingSession,
      setSelectedModel,
      setExecutingMode,
    ]
  )

  // Handle plan approval with yolo mode
  const handlePlanApprovalYolo = useCallback(
    (card: SessionCardData) => {
      if (!card.pendingPlanMessageId) return

      const sessionId = card.session.id
      const messageId = card.pendingPlanMessageId

      markPlanApproved(worktreeId, worktreePath, sessionId, messageId)

      queryClient.setQueryData<Session>(
        chatQueryKeys.session(sessionId),
        old => {
          if (!old) return old
          return {
            ...old,
            messages: old.messages.map(msg =>
              msg.id === messageId ? { ...msg, plan_approved: true } : msg
            ),
          }
        }
      )

      setExecutionMode(sessionId, 'yolo')
      clearToolCalls(sessionId)
      clearStreamingContentBlocks(sessionId)
      setSessionReviewing(sessionId, false)
      setWaitingForInput(sessionId, false)
      // Note: Don't clear pendingPlanMessageId - keep plan accessible after approval

      const model = preferences?.selected_model ?? 'opus'
      const thinkingLevel = preferences?.thinking_level ?? 'off'

      setLastSentMessage(sessionId, 'Approved - yolo')
      setError(sessionId, null)
      addSendingSession(sessionId)
      setSelectedModel(sessionId, model)
      setExecutingMode(sessionId, 'yolo')

      sendMessage.mutate({
        sessionId,
        worktreeId,
        worktreePath,
        message: 'Approved - yolo',
        model,
        executionMode: 'yolo',
        thinkingLevel,
        disableThinkingForMode: true,
      })
    },
    [
      worktreeId,
      worktreePath,
      queryClient,
      preferences,
      sendMessage,
      setExecutionMode,
      clearToolCalls,
      clearStreamingContentBlocks,
      setSessionReviewing,
      setWaitingForInput,
      setLastSentMessage,
      setError,
      addSendingSession,
      setSelectedModel,
      setExecutingMode,
    ]
  )

  // Handle plan view
  const handlePlanView = useCallback((card: SessionCardData) => {
    if (card.planFilePath) {
      setPlanDialogPath(card.planFilePath)
      setPlanDialogContent(null)
    } else if (card.planContent) {
      setPlanDialogContent(card.planContent)
      setPlanDialogPath(null)
    }
  }, [])

  // Listen for keyboard shortcut events for selected session
  useEffect(() => {
    // Only handle when we have a keyboard-selected session and modal is not open
    if (selectedSessionId || selectedIndex === null) return

    const card = sessionCards[selectedIndex]
    if (!card) return

    const handleApprovePlan = () => {
      if (card.hasExitPlanMode && !card.hasQuestion) {
        handlePlanApproval(card)
      }
    }

    const handleApprovePlanYolo = () => {
      if (card.hasExitPlanMode && !card.hasQuestion) {
        handlePlanApprovalYolo(card)
      }
    }

    const handleOpenPlan = () => {
      if (card.planFilePath || card.planContent) {
        handlePlanView(card)
      }
    }

    window.addEventListener('approve-plan', handleApprovePlan)
    window.addEventListener('approve-plan-yolo', handleApprovePlanYolo)
    window.addEventListener('open-plan', handleOpenPlan)

    return () => {
      window.removeEventListener('approve-plan', handleApprovePlan)
      window.removeEventListener('approve-plan-yolo', handleApprovePlanYolo)
      window.removeEventListener('open-plan', handleOpenPlan)
    }
  }, [
    selectedSessionId,
    selectedIndex,
    sessionCards,
    handlePlanApproval,
    handlePlanApprovalYolo,
    handlePlanView,
  ])

  return (
    <div ref={containerRef} className="flex h-full flex-col p-4">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          {project?.name}
          {sessionLabel && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({sessionLabel})
            </span>
          )}
        </h2>
        <span className="text-sm text-muted-foreground">
          {sessionCards.length} session{sessionCards.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
            ref={searchInputRef}
            placeholder="Search sessions..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-9"
          />
      </div>

      {/* Canvas View */}
      <div className="flex-1 min-h-0 overflow-auto">
        {sessionCards.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            {searchQuery
              ? 'No sessions match your search'
              : 'No sessions yet'}
          </div>
        ) : (
          <div className="flex flex-row flex-wrap gap-3">
            {sessionCards.map((card, index) => (
              <SessionCard
                key={card.session.id}
                ref={el => {
                  cardRefs.current[index] = el
                }}
                card={card}
                isSelected={selectedIndex === index}
                onSelect={() => {
                  setSelectedIndex(index)
                  handleSessionClick(card.session.id)
                }}
                onArchive={() => handleArchiveSession(card.session.id)}
                onDelete={() => handleDeleteSession(card.session.id)}
                onPlanView={() => handlePlanView(card)}
                onApprove={() => handlePlanApproval(card)}
                onYolo={() => handlePlanApprovalYolo(card)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Plan Dialog */}
      {planDialogPath ? (
        <PlanDialog
          filePath={planDialogPath}
          isOpen={true}
          onClose={() => setPlanDialogPath(null)}
        />
      ) : planDialogContent ? (
        <PlanDialog
          content={planDialogContent}
          isOpen={true}
          onClose={() => setPlanDialogContent(null)}
        />
      ) : null}

      {/* Session Chat Modal */}
      <SessionChatModal
        sessionId={selectedSessionId}
        worktreeId={worktreeId}
        worktreePath={worktreePath}
        isOpen={!!selectedSessionId}
        onClose={() => setSelectedSessionId(null)}
        onOpenFullView={handleOpenFullView}
      />
    </div>
  )
}
