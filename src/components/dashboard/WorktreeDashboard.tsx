import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { invoke } from '@/lib/transport'
import { Search, GitBranch } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import {
  useWorktrees,
  useProjects,
  isTauri,
  useArchiveWorktree,
  useCloseBaseSessionClean,
} from '@/services/projects'
import {
  chatQueryKeys,
  useSendMessage,
  markPlanApproved,
  useArchiveSession,
  useCloseSession,
  useCreateSession,
} from '@/services/chat'
import { usePreferences } from '@/services/preferences'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import { isBaseSession, type Worktree } from '@/types/projects'
import type { Session, WorktreeSessions } from '@/types/chat'
import { PlanDialog } from '@/components/chat/PlanDialog'
import { SessionChatModal } from '@/components/chat/SessionChatModal'
import { SessionCard } from '@/components/chat/SessionCard'
import {
  type SessionCardData,
  type ChatStoreState,
  computeSessionCardData,
} from '@/components/chat/session-card-utils'

interface WorktreeDashboardProps {
  projectId: string
}

interface WorktreeSection {
  worktree: Worktree
  cards: SessionCardData[]
}

interface FlatCard {
  worktreeId: string
  worktreePath: string
  card: SessionCardData
  globalIndex: number
}

export function WorktreeDashboard({ projectId }: WorktreeDashboardProps) {
  const queryClient = useQueryClient()
  const [searchQuery, setSearchQuery] = useState('')

  // Get project info
  const { data: projects = [], isLoading: projectsLoading } = useProjects()
  const project = projects.find(p => p.id === projectId)
  const { data: preferences } = usePreferences()

  // Get worktrees
  const { data: worktrees = [], isLoading: worktreesLoading } =
    useWorktrees(projectId)

  // Filter to ready worktrees only
  const readyWorktrees = useMemo(() => {
    return worktrees.filter(
      wt => !wt.status || wt.status === 'ready' || wt.status === 'error'
    )
  }, [worktrees])

  // Load sessions for all worktrees dynamically using useQueries
  const sessionQueries = useQueries({
    queries: readyWorktrees.map(wt => ({
      queryKey: [...chatQueryKeys.sessions(wt.id), 'with-counts'],
      queryFn: async (): Promise<WorktreeSessions> => {
        if (!isTauri() || !wt.id || !wt.path) {
          return {
            worktree_id: wt.id,
            sessions: [],
            active_session_id: null,
            version: 2,
          }
        }
        return invoke<WorktreeSessions>('get_sessions', {
          worktreeId: wt.id,
          worktreePath: wt.path,
          includeMessageCounts: true,
        })
      },
      enabled: !!wt.id && !!wt.path,
    })),
  })

  // Build a Map of worktree ID -> session data for stable lookups
  const sessionsByWorktreeId = useMemo(() => {
    const map = new Map<string, { sessions: Session[]; isLoading: boolean }>()
    for (const query of sessionQueries) {
      const worktreeId = query.data?.worktree_id
      if (worktreeId) {
        map.set(worktreeId, {
          sessions: query.data?.sessions ?? [],
          isLoading: query.isLoading,
        })
      }
    }
    return map
  }, [sessionQueries])

  // Subscribe to chat store state for status computation
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

  const storeState: ChatStoreState = useMemo(
    () => ({
      sendingSessionIds,
      executingModes,
      executionModes,
      activeToolCalls,
      answeredQuestions,
      waitingForInputSessionIds,
      reviewingSessions,
      pendingPermissionDenials,
    }),
    [
      sendingSessionIds,
      executingModes,
      executionModes,
      activeToolCalls,
      answeredQuestions,
      waitingForInputSessionIds,
      reviewingSessions,
      pendingPermissionDenials,
    ]
  )

  // Build worktree sections with computed card data
  const worktreeSections: WorktreeSection[] = useMemo(() => {
    const result: WorktreeSection[] = []

    // Sort worktrees: base sessions first, then by created_at (newest first)
    const sortedWorktrees = [...readyWorktrees].sort((a, b) => {
      const aIsBase = isBaseSession(a)
      const bIsBase = isBaseSession(b)
      if (aIsBase && !bIsBase) return -1
      if (!aIsBase && bIsBase) return 1
      return b.created_at - a.created_at
    })

    for (const worktree of sortedWorktrees) {
      const sessionData = sessionsByWorktreeId.get(worktree.id)
      const sessions = sessionData?.sessions ?? []

      // Filter sessions based on search query
      const filteredSessions = searchQuery.trim()
        ? sessions.filter(session =>
            session.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            worktree.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            worktree.branch.toLowerCase().includes(searchQuery.toLowerCase())
          )
        : sessions

      // Compute card data for each session
      const cards = filteredSessions.map(session =>
        computeSessionCardData(session, storeState)
      )

      // Only include worktrees that have sessions (after filtering)
      if (cards.length > 0) {
        result.push({ worktree, cards })
      }
    }

    return result
  }, [readyWorktrees, sessionsByWorktreeId, storeState, searchQuery])

  // Build flat array of all cards for keyboard navigation
  const flatCards: FlatCard[] = useMemo(() => {
    const result: FlatCard[] = []
    let globalIndex = 0
    for (const section of worktreeSections) {
      for (const card of section.cards) {
        result.push({
          worktreeId: section.worktree.id,
          worktreePath: section.worktree.path,
          card,
          globalIndex,
        })
        globalIndex++
      }
    }
    return result
  }, [worktreeSections])

  // Dialog state
  const [planDialogPath, setPlanDialogPath] = useState<string | null>(null)
  const [planDialogContent, setPlanDialogContent] = useState<string | null>(
    null
  )
  const [selectedSession, setSelectedSession] = useState<{
    sessionId: string
    worktreeId: string
    worktreePath: string
  } | null>(null)

  // Keyboard navigation state
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const cardRefs = useRef<(HTMLDivElement | null)[]>([])
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Listen for focus-canvas-search event
  useEffect(() => {
    const handleFocusSearch = () => searchInputRef.current?.focus()
    window.addEventListener('focus-canvas-search', handleFocusSearch)
    return () => window.removeEventListener('focus-canvas-search', handleFocusSearch)
  }, [])

  // Track session modal open state for magic command keybindings
  useEffect(() => {
    useUIStore.getState().setSessionChatModalOpen(
      !!selectedSession,
      selectedSession?.worktreeId ?? null
    )
  }, [selectedSession])

  // Projects store actions
  const selectProject = useProjectsStore(state => state.selectProject)
  const selectWorktree = useProjectsStore(state => state.selectWorktree)
  const setActiveWorktree = useChatStore(state => state.setActiveWorktree)
  const setActiveSession = useChatStore(state => state.setActiveSession)

  // Mutations
  const sendMessage = useSendMessage()
  const archiveSession = useArchiveSession()
  const closeSession = useCloseSession()
  const archiveWorktree = useArchiveWorktree()
  const closeBaseSessionClean = useCloseBaseSessionClean()
  const createSession = useCreateSession()

  // Actions via getState()
  const {
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
    setPendingPlanMessageId,
  } = useChatStore.getState()

  // Find the card visually below/above the current one
  const findVerticalNeighbor = useCallback(
    (currentIndex: number, direction: 'up' | 'down'): number | null => {
      const currentRef = cardRefs.current[currentIndex]
      if (!currentRef) return null

      const currentRect = currentRef.getBoundingClientRect()
      const currentCenterX = currentRect.left + currentRect.width / 2

      let bestIndex: number | null = null
      let bestDistance = Infinity

      for (let i = 0; i < cardRefs.current.length; i++) {
        if (i === currentIndex) continue
        const ref = cardRefs.current[i]
        if (!ref) continue

        const rect = ref.getBoundingClientRect()

        // Check if card is in the correct direction
        if (direction === 'down' && rect.top <= currentRect.bottom) continue
        if (direction === 'up' && rect.bottom >= currentRect.top) continue

        // Calculate horizontal distance (how aligned it is)
        const cardCenterX = rect.left + rect.width / 2
        const horizontalDistance = Math.abs(cardCenterX - currentCenterX)

        // Calculate vertical distance
        const verticalDistance =
          direction === 'down'
            ? rect.top - currentRect.bottom
            : currentRect.top - rect.bottom

        // Prefer cards that are horizontally aligned and close vertically
        // Weight horizontal alignment more heavily
        const distance = horizontalDistance + verticalDistance * 0.5

        if (distance < bestDistance) {
          bestDistance = distance
          bestIndex = i
        }
      }

      return bestIndex
    },
    []
  )

  // Handle clicking on a session card - open modal
  const handleSessionClick = useCallback(
    (worktreeId: string, worktreePath: string, sessionId: string) => {
      setSelectedSession({ sessionId, worktreeId, worktreePath })
    },
    []
  )

  // Global keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (selectedSession) return
      if (
        document.activeElement?.tagName === 'INPUT' ||
        document.activeElement?.tagName === 'TEXTAREA' ||
        (document.activeElement as HTMLElement)?.isContentEditable
      ) {
        return
      }

      const total = flatCards.length
      if (total === 0) return

      if (selectedIndex === null) {
        if (
          ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(e.key)
        ) {
          setSelectedIndex(0)
          e.preventDefault()
        }
        return
      }

      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault()
          if (selectedIndex < total - 1) setSelectedIndex(selectedIndex + 1)
          break
        case 'ArrowLeft':
          e.preventDefault()
          if (selectedIndex > 0) setSelectedIndex(selectedIndex - 1)
          break
        case 'ArrowDown': {
          e.preventDefault()
          const nextIndex = findVerticalNeighbor(selectedIndex, 'down')
          if (nextIndex !== null) setSelectedIndex(nextIndex)
          break
        }
        case 'ArrowUp': {
          e.preventDefault()
          const prevIndex = findVerticalNeighbor(selectedIndex, 'up')
          if (prevIndex !== null) setSelectedIndex(prevIndex)
          break
        }
        case 'Enter':
          // Only handle plain Enter (no modifiers) - CMD+Enter is for approve_plan keybinding
          if (e.metaKey || e.ctrlKey) return
          e.preventDefault()
          if (flatCards[selectedIndex]) {
            const item = flatCards[selectedIndex]
            handleSessionClick(
              item.worktreeId,
              item.worktreePath,
              item.card.session.id
            )
          }
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    selectedIndex,
    selectedSession,
    flatCards,
    findVerticalNeighbor,
    handleSessionClick,
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
    if (selectedSession) {
      selectProject(projectId)
      selectWorktree(selectedSession.worktreeId)
      setActiveWorktree(selectedSession.worktreeId, selectedSession.worktreePath)
      setActiveSession(selectedSession.worktreeId, selectedSession.sessionId)
      setViewingCanvasTab(selectedSession.worktreeId, false)
      setSelectedSession(null)
    }
  }, [
    selectedSession,
    projectId,
    selectProject,
    selectWorktree,
    setActiveWorktree,
    setActiveSession,
    setViewingCanvasTab,
  ])

  // Handle archive session
  const handleArchiveSession = useCallback(
    (worktreeId: string, worktreePath: string, sessionId: string) => {
      const sessionData = sessionsByWorktreeId.get(worktreeId)
      const activeSessions =
        sessionData?.sessions.filter(s => !s.archived_at) ?? []
      const worktree = readyWorktrees.find(w => w.id === worktreeId)

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
      sessionsByWorktreeId,
      readyWorktrees,
      project,
      archiveSession,
      archiveWorktree,
      closeBaseSessionClean,
    ]
  )

  // Handle delete session
  const handleDeleteSession = useCallback(
    (worktreeId: string, worktreePath: string, sessionId: string) => {
      const sessionData = sessionsByWorktreeId.get(worktreeId)
      const activeSessions =
        sessionData?.sessions.filter(s => !s.archived_at) ?? []
      const worktree = readyWorktrees.find(w => w.id === worktreeId)

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
      sessionsByWorktreeId,
      readyWorktrees,
      project,
      closeSession,
      archiveWorktree,
      closeBaseSessionClean,
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

  // Handle plan approval
  const handlePlanApproval = useCallback(
    (worktreeId: string, worktreePath: string, card: SessionCardData) => {
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
      setPendingPlanMessageId(sessionId, null)

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
      queryClient,
      preferences,
      sendMessage,
      setExecutionMode,
      clearToolCalls,
      clearStreamingContentBlocks,
      setSessionReviewing,
      setWaitingForInput,
      setPendingPlanMessageId,
      setLastSentMessage,
      setError,
      addSendingSession,
      setSelectedModel,
      setExecutingMode,
    ]
  )

  // Handle plan approval with yolo mode
  const handlePlanApprovalYolo = useCallback(
    (worktreeId: string, worktreePath: string, card: SessionCardData) => {
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
      setPendingPlanMessageId(sessionId, null)

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
      queryClient,
      preferences,
      sendMessage,
      setExecutionMode,
      clearToolCalls,
      clearStreamingContentBlocks,
      setSessionReviewing,
      setWaitingForInput,
      setPendingPlanMessageId,
      setLastSentMessage,
      setError,
      addSendingSession,
      setSelectedModel,
      setExecutingMode,
    ]
  )

  // Listen for close-session-or-worktree event to handle CMD+W
  useEffect(() => {
    const handleCloseSessionOrWorktree = (e: Event) => {
      // If modal is open, close it
      if (selectedSession) {
        setSelectedSession(null)
        return
      }

      // If there's a keyboard-selected session, archive it
      if (selectedIndex !== null && flatCards[selectedIndex]) {
        e.stopImmediatePropagation()
        const item = flatCards[selectedIndex]
        handleArchiveSession(item.worktreeId, item.worktreePath, item.card.session.id)

        // Move selection to previous card, or clear if none left
        const total = flatCards.length
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
  }, [selectedSession, selectedIndex, flatCards, handleArchiveSession])

  // Listen for keyboard shortcut events for selected session
  useEffect(() => {
    // Only handle when we have a keyboard-selected session and modal is not open
    if (selectedSession || selectedIndex === null) return

    const item = flatCards[selectedIndex]
    if (!item) return

    const { card, worktreeId, worktreePath } = item

    const handleApprovePlanEvent = () => {
      if (card.hasExitPlanMode && !card.hasQuestion) {
        handlePlanApproval(worktreeId, worktreePath, card)
      }
    }

    const handleApprovePlanYoloEvent = () => {
      if (card.hasExitPlanMode && !card.hasQuestion) {
        handlePlanApprovalYolo(worktreeId, worktreePath, card)
      }
    }

    const handleOpenPlanEvent = () => {
      if (card.planFilePath || card.planContent) {
        handlePlanView(card)
      }
    }

    window.addEventListener('approve-plan', handleApprovePlanEvent)
    window.addEventListener('approve-plan-yolo', handleApprovePlanYoloEvent)
    window.addEventListener('open-plan', handleOpenPlanEvent)

    return () => {
      window.removeEventListener('approve-plan', handleApprovePlanEvent)
      window.removeEventListener('approve-plan-yolo', handleApprovePlanYoloEvent)
      window.removeEventListener('open-plan', handleOpenPlanEvent)
    }
  }, [
    selectedSession,
    selectedIndex,
    flatCards,
    handlePlanApproval,
    handlePlanApprovalYolo,
    handlePlanView,
  ])

  // Listen for create-new-session event to handle CMD+T
  useEffect(() => {
    const handleCreateNewSession = (e: Event) => {
      // Only handle when we have a keyboard-selected session and modal is not open
      if (selectedSession || selectedIndex === null) return

      const item = flatCards[selectedIndex]
      if (!item) return

      e.stopImmediatePropagation()

      createSession.mutate(
        { worktreeId: item.worktreeId, worktreePath: item.worktreePath },
        {
          onSuccess: session => {
            setSelectedSession({
              sessionId: session.id,
              worktreeId: item.worktreeId,
              worktreePath: item.worktreePath,
            })
          },
        }
      )
    }

    window.addEventListener('create-new-session', handleCreateNewSession, {
      capture: true,
    })
    return () =>
      window.removeEventListener('create-new-session', handleCreateNewSession, {
        capture: true,
      })
  }, [selectedSession, selectedIndex, flatCards, createSession])

  // Check if loading
  const isLoading =
    projectsLoading ||
    worktreesLoading ||
    (readyWorktrees.length > 0 &&
      readyWorktrees.some(wt => !sessionsByWorktreeId.has(wt.id)))

  if (isLoading && worktreeSections.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        No project selected
      </div>
    )
  }

  // Count total sessions across all worktrees
  const totalWorktrees = worktreeSections.length

  // Track global card index for refs
  let cardIndex = 0

  return (
    <div ref={containerRef} className="flex h-full flex-col p-4">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{project.name}</h2>
        <span className="text-sm text-muted-foreground">
          {totalWorktrees} worktree{totalWorktrees !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={searchInputRef}
          placeholder="Search worktrees and sessions..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Canvas View */}
      <div className="flex-1 min-h-0 overflow-auto">
        {worktreeSections.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            {searchQuery
              ? 'No worktrees or sessions match your search'
              : 'No worktrees yet'}
          </div>
        ) : (
          <div className="space-y-6">
            {worktreeSections.map(section => {
              const isBase = isBaseSession(section.worktree)

              return (
                <div key={section.worktree.id}>
                  {/* Worktree header */}
                  <div className="mb-3 flex items-center gap-2">
                    <GitBranch className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">
                      {isBase ? 'Base Session' : section.worktree.name}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      ({section.worktree.branch})
                    </span>
                    {isBase && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        base
                      </span>
                    )}
                  </div>

                  {/* Session cards grid */}
                  <div className="flex flex-row flex-wrap gap-3">
                    {section.cards.map(card => {
                      const currentIndex = cardIndex++
                      return (
                        <SessionCard
                          key={card.session.id}
                          ref={el => {
                            cardRefs.current[currentIndex] = el
                          }}
                          card={card}
                          isSelected={selectedIndex === currentIndex}
                          onSelect={() => {
                            setSelectedIndex(currentIndex)
                            handleSessionClick(
                              section.worktree.id,
                              section.worktree.path,
                              card.session.id
                            )
                          }}
                          onArchive={() =>
                            handleArchiveSession(
                              section.worktree.id,
                              section.worktree.path,
                              card.session.id
                            )
                          }
                          onDelete={() =>
                            handleDeleteSession(
                              section.worktree.id,
                              section.worktree.path,
                              card.session.id
                            )
                          }
                          onPlanView={() => handlePlanView(card)}
                          onApprove={() =>
                            handlePlanApproval(
                              section.worktree.id,
                              section.worktree.path,
                              card
                            )
                          }
                          onYolo={() =>
                            handlePlanApprovalYolo(
                              section.worktree.id,
                              section.worktree.path,
                              card
                            )
                          }
                        />
                      )
                    })}
                  </div>
                </div>
              )
            })}
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
        sessionId={selectedSession?.sessionId ?? null}
        worktreeId={selectedSession?.worktreeId ?? ''}
        worktreePath={selectedSession?.worktreePath ?? ''}
        isOpen={!!selectedSession}
        onClose={() => setSelectedSession(null)}
        onOpenFullView={handleOpenFullView}
      />
    </div>
  )
}
