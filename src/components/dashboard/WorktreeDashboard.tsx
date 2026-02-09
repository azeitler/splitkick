import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { useQueries } from '@tanstack/react-query'
import { invoke } from '@/lib/transport'
import {
  Search,
  GitBranch,
  MoreHorizontal,
  Settings,
  Plus,
  Loader2,
} from 'lucide-react'
import { WorktreeDropdownMenu } from '@/components/projects/WorktreeDropdownMenu'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { GitStatusBadges } from '@/components/ui/git-status-badges'
import {
  useWorktrees,
  useProjects,
  useCreateWorktree,
  useCreateBaseSession,
  isTauri,
} from '@/services/projects'
import { chatQueryKeys, useCreateSession } from '@/services/chat'
import { useGitStatus } from '@/services/git-status'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import { isBaseSession, type Worktree } from '@/types/projects'
import type { Session, WorktreeSessions } from '@/types/chat'
import { NewIssuesBadge } from '@/components/shared/NewIssuesBadge'
import { PlanDialog } from '@/components/chat/PlanDialog'
import { RecapDialog } from '@/components/chat/RecapDialog'
import { SessionChatModal } from '@/components/chat/SessionChatModal'
import { SessionCard } from '@/components/chat/SessionCard'
import {
  type SessionCardData,
  computeSessionCardData,
} from '@/components/chat/session-card-utils'
import { WorktreeSetupCard } from '@/components/chat/WorktreeSetupCard'
import { useCanvasStoreState } from '@/components/chat/hooks/useCanvasStoreState'
import { usePlanApproval } from '@/components/chat/hooks/usePlanApproval'
import { useCanvasKeyboardNav } from '@/components/chat/hooks/useCanvasKeyboardNav'
import { useCanvasShortcutEvents } from '@/components/chat/hooks/useCanvasShortcutEvents'
import {
  useArchiveWorktree,
  useCloseBaseSessionClean,
} from '@/services/projects'
import { useArchiveSession, useCloseSession } from '@/services/chat'
import { usePreferences } from '@/services/preferences'
import { KeybindingHints } from '@/components/ui/keybinding-hints'
import { DEFAULT_KEYBINDINGS } from '@/types/keybindings'
import { GitDiffModal } from '@/components/chat/GitDiffModal'
import type { DiffRequest } from '@/types/git-diff'
import { toast } from 'sonner'
import {
  gitPull,
  gitPush,
  fetchWorktreesStatus,
  triggerImmediateGitPoll,
} from '@/services/git-status'

interface WorktreeDashboardProps {
  projectId: string
}

interface WorktreeSection {
  worktree: Worktree
  cards: SessionCardData[]
  isPending?: boolean
}

interface FlatCard {
  worktreeId: string
  worktreePath: string
  card: SessionCardData | null // null for pending worktrees
  globalIndex: number
  isPending?: boolean
}

function WorktreeSectionHeader({
  worktree,
  projectId,
  defaultBranch,
}: {
  worktree: Worktree
  projectId: string
  defaultBranch: string
}) {
  const isBase = isBaseSession(worktree)
  const { data: gitStatus } = useGitStatus(worktree.id)
  const [diffRequest, setDiffRequest] = useState<DiffRequest | null>(null)

  const behindCount =
    gitStatus?.behind_count ?? worktree.cached_behind_count ?? 0
  const unpushedCount =
    gitStatus?.unpushed_count ?? worktree.cached_unpushed_count ?? 0

  // Non-base: branch diff vs base; base: uncommitted changes
  const diffAdded = isBase
    ? (gitStatus?.uncommitted_added ?? worktree.cached_uncommitted_added ?? 0)
    : (gitStatus?.branch_diff_added ?? worktree.cached_branch_diff_added ?? 0)
  const diffRemoved = isBase
    ? (gitStatus?.uncommitted_removed ??
      worktree.cached_uncommitted_removed ??
      0)
    : (gitStatus?.branch_diff_removed ??
      worktree.cached_branch_diff_removed ??
      0)

  const handlePull = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      const { setWorktreeLoading, clearWorktreeLoading } =
        useChatStore.getState()
      setWorktreeLoading(worktree.id, 'pull')
      const toastId = toast.loading('Pulling changes...')
      try {
        await gitPull(worktree.path, defaultBranch)
        triggerImmediateGitPoll()
        fetchWorktreesStatus(projectId)
        toast.success('Changes pulled', { id: toastId })
      } catch (error) {
        toast.error(`Pull failed: ${error}`, { id: toastId })
      } finally {
        clearWorktreeLoading(worktree.id)
      }
    },
    [worktree.id, worktree.path, defaultBranch, projectId]
  )

  const handlePush = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      const toastId = toast.loading('Pushing changes...')
      try {
        await gitPush(worktree.path, worktree.pr_number)
        triggerImmediateGitPoll()
        fetchWorktreesStatus(projectId)
        toast.success('Changes pushed', { id: toastId })
      } catch (error) {
        toast.error(`Push failed: ${error}`, { id: toastId })
      }
    },
    [worktree.path, worktree.pr_number, projectId]
  )

  const handleDiffClick = useCallback(() => {
    setDiffRequest({
      type: isBase ? 'uncommitted' : 'branch',
      worktreePath: worktree.path,
      baseBranch: defaultBranch,
    })
  }, [isBase, worktree.path, defaultBranch])

  return (
    <>
      <div className="mb-3 flex items-center gap-2">
        <GitBranch className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">
          {isBase ? 'Base Session' : worktree.name}
        </span>
        {worktree.name !== worktree.branch && (
          <span className="text-sm text-muted-foreground">
            ({worktree.branch})
          </span>
        )}
        {isBase && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
            base
          </span>
        )}
        <WorktreeDropdownMenu worktree={worktree} projectId={projectId} />
        <GitStatusBadges
          behindCount={behindCount}
          unpushedCount={unpushedCount}
          diffAdded={diffAdded}
          diffRemoved={diffRemoved}
          onPull={handlePull}
          onPush={handlePush}
          onDiffClick={handleDiffClick}
        />
      </div>
      <GitDiffModal
        diffRequest={diffRequest}
        onClose={() => setDiffRequest(null)}
      />
    </>
  )
}

export function WorktreeDashboard({ projectId }: WorktreeDashboardProps) {
  // Preferences for keybinding hints
  const { data: preferences } = usePreferences()

  const [searchQuery, setSearchQuery] = useState('')

  // Get project info
  const { data: projects = [], isLoading: projectsLoading } = useProjects()
  const project = projects.find(p => p.id === projectId)

  // Get worktrees
  const { data: worktrees = [], isLoading: worktreesLoading } =
    useWorktrees(projectId)

  // Filter worktrees: include ready, pending, and error (exclude deleting)
  const visibleWorktrees = useMemo(() => {
    return worktrees.filter(wt => wt.status !== 'deleting')
  }, [worktrees])

  // Separate ready and pending worktrees for different handling
  const readyWorktrees = useMemo(() => {
    return visibleWorktrees.filter(
      wt => !wt.status || wt.status === 'ready' || wt.status === 'error'
    )
  }, [visibleWorktrees])

  const pendingWorktrees = useMemo(() => {
    return visibleWorktrees.filter(wt => wt.status === 'pending')
  }, [visibleWorktrees])

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

  // Create worktree/base session for empty state
  const createWorktree = useCreateWorktree()
  const createBaseSession = useCreateBaseSession()
  const hasBaseSession = worktrees.some(wt => isBaseSession(wt))

  const handleEmptyCreateWorktree = useCallback(() => {
    createWorktree.mutate({ projectId })
  }, [projectId, createWorktree])

  const handleEmptyBaseSession = useCallback(() => {
    if (hasBaseSession) {
      const base = worktrees.find(wt => isBaseSession(wt))
      if (base) {
        const { selectWorktree } = useProjectsStore.getState()
        const { setActiveWorktree } = useChatStore.getState()
        selectWorktree(base.id)
        setActiveWorktree(base.id, base.path)
      }
    } else {
      createBaseSession.mutate(projectId)
    }
  }, [projectId, hasBaseSession, worktrees, createBaseSession])

  // Use shared store state hook
  const storeState = useCanvasStoreState()

  // Build worktree sections with computed card data
  const worktreeSections: WorktreeSection[] = useMemo(() => {
    const result: WorktreeSection[] = []

    // Add pending worktrees first (newest first by created_at)
    const sortedPending = [...pendingWorktrees].sort(
      (a, b) => b.created_at - a.created_at
    )
    for (const worktree of sortedPending) {
      // Include pending worktrees even without sessions - show setup card
      result.push({ worktree, cards: [], isPending: true })
    }

    // Sort ready worktrees: base sessions first, then by created_at (newest first)
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
        ? sessions.filter(
            session =>
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
  }, [
    readyWorktrees,
    pendingWorktrees,
    sessionsByWorktreeId,
    storeState,
    searchQuery,
  ])

  // Build flat array of all cards for keyboard navigation
  const flatCards: FlatCard[] = useMemo(() => {
    const result: FlatCard[] = []
    let globalIndex = 0
    for (const section of worktreeSections) {
      if (section.isPending) {
        // Add a single entry for the pending worktree's setup card
        result.push({
          worktreeId: section.worktree.id,
          worktreePath: section.worktree.path,
          card: null,
          globalIndex,
          isPending: true,
        })
        globalIndex++
      } else {
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
    }
    return result
  }, [worktreeSections])

  // Selection state
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [selectedSession, setSelectedSession] = useState<{
    sessionId: string
    worktreeId: string
    worktreePath: string
  } | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Get current selected card's worktree info for hooks
  const selectedFlatCard =
    selectedIndex !== null ? flatCards[selectedIndex] : null

  // Use shared hooks - pass the currently selected card's worktree
  const { handlePlanApproval, handlePlanApprovalYolo } = usePlanApproval({
    worktreeId: selectedFlatCard?.worktreeId ?? '',
    worktreePath: selectedFlatCard?.worktreePath ?? '',
  })

  // Archive mutations - need to handle per-worktree
  const archiveSession = useArchiveSession()
  const closeSession = useCloseSession()
  const archiveWorktree = useArchiveWorktree()
  const closeBaseSessionClean = useCloseBaseSessionClean()

  // Listen for focus-canvas-search event
  useEffect(() => {
    const handleFocusSearch = () => searchInputRef.current?.focus()
    window.addEventListener('focus-canvas-search', handleFocusSearch)
    return () =>
      window.removeEventListener('focus-canvas-search', handleFocusSearch)
  }, [])

  // Track session modal open state for magic command keybindings
  useEffect(() => {
    useUIStore
      .getState()
      .setSessionChatModalOpen(
        !!selectedSession,
        selectedSession?.worktreeId ?? null
      )
  }, [selectedSession])

  // Sync selectedIndex when selectedSession changes and flatCards updates
  useEffect(() => {
    if (!selectedSession) return
    const cardIndex = flatCards.findIndex(
      fc =>
        fc.worktreeId === selectedSession.worktreeId &&
        fc.card?.session.id === selectedSession.sessionId
    )
    console.log(
      '[WorktreeDashboard] sync selectedIndex - cardIndex:',
      cardIndex,
      'for session:',
      selectedSession.sessionId
    )
    if (cardIndex !== -1 && cardIndex !== selectedIndex) {
      setSelectedIndex(cardIndex)
    }
  }, [selectedSession, flatCards, selectedIndex])

  // Auto-open session modal for newly created worktrees
  useEffect(() => {
    for (const [worktreeId, sessionData] of sessionsByWorktreeId) {
      if (!sessionData.sessions.length) continue

      const shouldAutoOpen = useUIStore
        .getState()
        .consumeAutoOpenSession(worktreeId)
      if (!shouldAutoOpen) continue

      const worktree = readyWorktrees.find(w => w.id === worktreeId)
      const firstSession = sessionData.sessions[0]
      if (worktree && firstSession) {
        // Find the index in flatCards for keyboard selection
        const cardIndex = flatCards.findIndex(
          fc =>
            fc.worktreeId === worktreeId &&
            fc.card?.session.id === firstSession.id
        )
        if (cardIndex !== -1) {
          setSelectedIndex(cardIndex)
        }

        setSelectedSession({
          sessionId: firstSession.id,
          worktreeId,
          worktreePath: worktree.path,
        })
        break // Only one per render cycle
      }
    }
  }, [sessionsByWorktreeId, readyWorktrees, flatCards])

  // Auto-select first session when dashboard opens (visual selection only, no modal)
  useEffect(() => {
    if (selectedIndex !== null || selectedSession) return
    const firstCardIndex = flatCards.findIndex(
      fc => fc.card !== null && !fc.isPending
    )
    if (firstCardIndex === -1) return
    const firstCard = flatCards[firstCardIndex]
    setSelectedIndex(firstCardIndex)
    if (firstCard?.card) {
      useChatStore
        .getState()
        .setCanvasSelectedSession(
          firstCard.worktreeId,
          firstCard.card.session.id
        )
      // Sync projects store so commands (CMD+O, open terminal, etc.) work immediately
      useProjectsStore.getState().selectWorktree(firstCard.worktreeId)
      useChatStore
        .getState()
        .registerWorktreePath(firstCard.worktreeId, firstCard.worktreePath)
    }
  }, [flatCards, selectedIndex, selectedSession])

  // Projects store actions
  const selectProject = useProjectsStore(state => state.selectProject)
  const selectWorktree = useProjectsStore(state => state.selectWorktree)
  const setActiveWorktree = useChatStore(state => state.setActiveWorktree)
  const setActiveSession = useChatStore(state => state.setActiveSession)

  // Mutations
  const createSession = useCreateSession()

  // Actions via getState()
  const { setViewingCanvasTab } = useChatStore.getState()

  // Handle clicking on a session card - open modal
  const handleSessionClick = useCallback(
    (worktreeId: string, worktreePath: string, sessionId: string) => {
      setSelectedSession({ sessionId, worktreeId, worktreePath })
    },
    []
  )

  // Handle selection from keyboard nav
  const handleSelect = useCallback(
    (index: number) => {
      const item = flatCards[index]
      // Skip opening session for pending worktrees (they have no sessions yet)
      if (item && item.card) {
        handleSessionClick(
          item.worktreeId,
          item.worktreePath,
          item.card.session.id
        )
      }
    },
    [flatCards, handleSessionClick]
  )

  // Handle selection change for tracking in store
  const handleSelectionChange = useCallback(
    (index: number) => {
      const item = flatCards[index]
      if (item) {
        // Sync projects store so CMD+O uses the correct worktree
        useProjectsStore.getState().selectWorktree(item.worktreeId)
        // Register worktree path so OpenInModal can find it
        useChatStore
          .getState()
          .registerWorktreePath(item.worktreeId, item.worktreePath)
      }
    },
    [flatCards]
  )

  // Get selected card for shortcut events
  const selectedCard = selectedFlatCard?.card ?? null

  // Shortcut events (plan, recap, approve) - must be before keyboard nav to get dialog states
  const {
    planDialogPath,
    planDialogContent,
    planApprovalContext,
    planDialogCard,
    closePlanDialog,
    recapDialogDigest,
    closeRecapDialog,
    handlePlanView,
    handleRecapView,
  } = useCanvasShortcutEvents({
    selectedCard,
    enabled: !selectedSession && selectedIndex !== null,
    worktreeId: selectedFlatCard?.worktreeId ?? '',
    worktreePath: selectedFlatCard?.worktreePath ?? '',
    onPlanApproval: (card, updatedPlan) =>
      handlePlanApproval(card, updatedPlan),
    onPlanApprovalYolo: (card, updatedPlan) =>
      handlePlanApprovalYolo(card, updatedPlan),
  })

  // Keyboard navigation - disable when any modal/dialog is open
  const isModalOpen =
    !!selectedSession ||
    !!planDialogPath ||
    !!planDialogContent ||
    !!recapDialogDigest
  const { cardRefs } = useCanvasKeyboardNav({
    cards: flatCards,
    selectedIndex,
    onSelectedIndexChange: setSelectedIndex,
    onSelect: handleSelect,
    enabled: !isModalOpen,
    onSelectionChange: handleSelectionChange,
  })

  // Handle approve from dialog (with updated plan content)
  const handleDialogApprove = useCallback(
    (updatedPlan: string) => {
      console.log(
        '[WorktreeDashboard] handleDialogApprove called, updatedPlan length:',
        updatedPlan?.length
      )
      console.log(
        '[WorktreeDashboard] planDialogCard:',
        planDialogCard?.session?.id
      )
      if (planDialogCard) {
        handlePlanApproval(planDialogCard, updatedPlan)
      } else {
        console.log(
          '[WorktreeDashboard] handleDialogApprove - planDialogCard is null!'
        )
      }
    },
    [planDialogCard, handlePlanApproval]
  )

  const handleDialogApproveYolo = useCallback(
    (updatedPlan: string) => {
      console.log(
        '[WorktreeDashboard] handleDialogApproveYolo called, updatedPlan length:',
        updatedPlan?.length
      )
      console.log(
        '[WorktreeDashboard] planDialogCard:',
        planDialogCard?.session?.id
      )
      if (planDialogCard) {
        handlePlanApprovalYolo(planDialogCard, updatedPlan)
      } else {
        console.log(
          '[WorktreeDashboard] handleDialogApproveYolo - planDialogCard is null!'
        )
      }
    },
    [planDialogCard, handlePlanApprovalYolo]
  )

  // Handle opening full view from modal
  const handleOpenFullView = useCallback(() => {
    if (selectedSession) {
      selectProject(projectId)
      selectWorktree(selectedSession.worktreeId)
      setActiveWorktree(
        selectedSession.worktreeId,
        selectedSession.worktreePath
      )
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

  // Handle archive session for a specific worktree
  const handleArchiveSessionForWorktree = useCallback(
    (worktreeId: string, worktreePath: string, sessionId: string) => {
      const worktree = readyWorktrees.find(w => w.id === worktreeId)
      const sessionData = sessionsByWorktreeId.get(worktreeId)
      const activeSessions =
        sessionData?.sessions?.filter(s => !s.archived_at) ?? []

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
      readyWorktrees,
      sessionsByWorktreeId,
      project,
      archiveSession,
      archiveWorktree,
      closeBaseSessionClean,
    ]
  )

  // Handle delete session for a specific worktree
  const handleDeleteSessionForWorktree = useCallback(
    (worktreeId: string, worktreePath: string, sessionId: string) => {
      const worktree = readyWorktrees.find(w => w.id === worktreeId)
      const sessionData = sessionsByWorktreeId.get(worktreeId)
      const activeSessions =
        sessionData?.sessions?.filter(s => !s.archived_at) ?? []

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
      readyWorktrees,
      sessionsByWorktreeId,
      project,
      closeSession,
      archiveWorktree,
      closeBaseSessionClean,
    ]
  )

  // Listen for close-session-or-worktree event to handle CMD+W
  useEffect(() => {
    const handleCloseSessionOrWorktree = (e: Event) => {
      // If modal is open, archive the session, close modal, pre-select next on canvas
      if (selectedSession) {
        e.stopImmediatePropagation()
        const closingWorktreeId = selectedSession.worktreeId
        const closingSessionId = selectedSession.sessionId

        handleArchiveSessionForWorktree(
          selectedSession.worktreeId,
          selectedSession.worktreePath,
          closingSessionId
        )
        setSelectedSession(null)

        // Find remaining sessions in same worktree
        const sameWorktreeSessions = flatCards.filter(
          fc =>
            fc.worktreeId === closingWorktreeId &&
            fc.card &&
            fc.card.session.id !== closingSessionId
        )

        if (sameWorktreeSessions.length === 0) {
          // No sessions left in worktree - select nearest card from any worktree
          const closingIndex = flatCards.findIndex(
            fc => fc.card?.session.id === closingSessionId
          )
          if (closingIndex >= 0) {
            let nearestIndex: number | null = null
            let minDistance = Infinity
            for (let i = 0; i < flatCards.length; i++) {
              if (i === closingIndex) continue
              const distance = Math.abs(i - closingIndex)
              if (distance < minDistance) {
                minDistance = distance
                nearestIndex = i
              }
            }
            if (nearestIndex !== null && nearestIndex > closingIndex) {
              nearestIndex--
            }
            setSelectedIndex(nearestIndex)
          }
        } else {
          // Pick next session in same worktree and pre-select on canvas
          const worktreeCards = flatCards.filter(
            fc => fc.worktreeId === closingWorktreeId && fc.card
          )
          const indexInWorktree = worktreeCards.findIndex(
            fc => fc.card?.session.id === closingSessionId
          )
          const nextCard =
            indexInWorktree < sameWorktreeSessions.length
              ? sameWorktreeSessions[indexInWorktree]
              : sameWorktreeSessions[sameWorktreeSessions.length - 1]

          if (nextCard?.card) {
            const newGlobalIndex = flatCards.findIndex(
              fc =>
                fc.worktreeId === nextCard.worktreeId &&
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                fc.card?.session.id === nextCard.card!.session.id
            )
            const closingGlobalIndex = flatCards.findIndex(
              fc => fc.card?.session.id === closingSessionId
            )
            setSelectedIndex(
              newGlobalIndex > closingGlobalIndex
                ? newGlobalIndex - 1
                : newGlobalIndex
            )
          }
        }
        return
      }

      // If there's a keyboard-selected session, archive it
      // (skip for pending worktrees which have no sessions)
      if (selectedIndex !== null && flatCards[selectedIndex]) {
        const item = flatCards[selectedIndex]
        // Skip if this is a pending worktree setup card (no session to close)
        if (!item.card) return

        e.stopImmediatePropagation()
        const closingWorktreeId = item.worktreeId

        handleArchiveSessionForWorktree(
          item.worktreeId,
          item.worktreePath,
          item.card.session.id
        )

        // Find remaining sessions in same worktree (excluding the one being closed)
        const sameWorktreeSessions = flatCards.filter(
          fc =>
            fc.worktreeId === closingWorktreeId &&
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            fc.card?.session.id !== item.card!.session.id
        )

        if (sameWorktreeSessions.length === 0) {
          // No sessions left in worktree - find nearest from any worktree
          const closingIndex = selectedIndex
          let nearestIndex: number | null = null
          let minDistance = Infinity
          for (let i = 0; i < flatCards.length; i++) {
            if (i === closingIndex) continue
            const distance = Math.abs(i - closingIndex)
            if (distance < minDistance) {
              minDistance = distance
              nearestIndex = i
            }
          }
          // Adjust for removed card
          if (nearestIndex !== null && nearestIndex > closingIndex) {
            nearestIndex--
          }
          setSelectedIndex(nearestIndex)
        } else {
          // Sessions remain in same worktree - pick next (or last if closing last)
          const worktreeSessions = flatCards.filter(
            fc => fc.worktreeId === closingWorktreeId && fc.card
          )
          const indexInWorktree = worktreeSessions.findIndex(
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            fc => fc.card?.session.id === item.card!.session.id
          )
          const nextInWorktree =
            indexInWorktree < sameWorktreeSessions.length
              ? sameWorktreeSessions[indexInWorktree]
              : sameWorktreeSessions[sameWorktreeSessions.length - 1]

          if (!nextInWorktree || !nextInWorktree.card) return

          // Find global index and adjust for removal
          const newGlobalIndex = flatCards.findIndex(
            fc =>
              fc.worktreeId === nextInWorktree.worktreeId &&
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              fc.card?.session.id === nextInWorktree.card!.session.id
          )
          setSelectedIndex(
            newGlobalIndex > selectedIndex ? newGlobalIndex - 1 : newGlobalIndex
          )
        }
      }
    }

    window.addEventListener(
      'close-session-or-worktree',
      handleCloseSessionOrWorktree,
      {
        capture: true,
      }
    )
    return () =>
      window.removeEventListener(
        'close-session-or-worktree',
        handleCloseSessionOrWorktree,
        { capture: true }
      )
  }, [
    selectedSession,
    selectedIndex,
    flatCards,
    handleArchiveSessionForWorktree,
  ])

  // Listen for create-new-session event to handle CMD+T
  useEffect(() => {
    const handleCreateNewSession = (e: Event) => {
      console.log('[WorktreeDashboard] handleCreateNewSession called')
      console.log('[WorktreeDashboard] selectedSession:', selectedSession)
      console.log('[WorktreeDashboard] selectedIndex:', selectedIndex)
      // Don't create if modal is already open
      if (selectedSession) return

      // Use selected card, or fallback to first card
      const item =
        selectedIndex !== null ? flatCards[selectedIndex] : flatCards[0]
      if (!item) return

      e.stopImmediatePropagation()

      createSession.mutate(
        { worktreeId: item.worktreeId, worktreePath: item.worktreePath },
        {
          onSuccess: session => {
            console.log(
              '[WorktreeDashboard] onSuccess - session.id:',
              session.id
            )
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

  // Listen for open-session-modal event (fired by ChatWindow when creating new session inside modal)
  useEffect(() => {
    const handleOpenSessionModal = (e: CustomEvent<{ sessionId: string }>) => {
      setSelectedSession(prev => {
        if (!prev) return prev
        return { ...prev, sessionId: e.detail.sessionId }
      })
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

  // Track global card index for refs
  let cardIndex = 0

  return (
    <div className="relative flex h-full flex-col">
      <div className="flex-1 flex flex-col overflow-auto">
        {/* Header with Search - sticky over content */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-4 bg-background/60 backdrop-blur-md px-4 py-3 border-b border-border/30">
          <div className="flex items-center gap-1 shrink-0">
            <h2 className="text-lg font-semibold">{project.name}</h2>
            <NewIssuesBadge projectPath={project.path} projectId={projectId} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem
                  onSelect={() =>
                    useProjectsStore.getState().openProjectSettings(projectId)
                  }
                >
                  <Settings className="h-4 w-4" />
                  Project Settings
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              placeholder="Search worktrees and sessions..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-9 bg-transparent border-border/30"
            />
          </div>
        </div>

        {/* Canvas View */}
        <div className="flex-1 pb-16 pt-6 px-4">
          {worktreeSections.length === 0 ? (
            searchQuery ? (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                No worktrees or sessions match your search
              </div>
            ) : (
              <EmptyDashboard
                hasBaseSession={hasBaseSession}
                onCreateWorktree={handleEmptyCreateWorktree}
                onBaseSession={handleEmptyBaseSession}
                isCreating={
                  createWorktree.isPending || createBaseSession.isPending
                }
              />
            )
          ) : (
            <div className="space-y-6">
              {worktreeSections.map(section => {
                return (
                  <div key={section.worktree.id}>
                    {/* Worktree header */}
                    <WorktreeSectionHeader
                      worktree={section.worktree}
                      projectId={projectId}
                      defaultBranch={project.default_branch}
                    />

                    {/* Session cards grid */}
                    <div className="flex flex-row flex-wrap gap-3">
                      {section.isPending
                        ? // Pending worktree: show setup card
                          (() => {
                            const currentIndex = cardIndex++
                            return (
                              <WorktreeSetupCard
                                key={section.worktree.id}
                                ref={el => {
                                  cardRefs.current[currentIndex] = el
                                }}
                                worktree={section.worktree}
                                isSelected={selectedIndex === currentIndex}
                                onSelect={() => setSelectedIndex(currentIndex)}
                              />
                            )
                          })()
                        : // Ready worktree: show session cards
                          section.cards.map(card => {
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
                                  handleArchiveSessionForWorktree(
                                    section.worktree.id,
                                    section.worktree.path,
                                    card.session.id
                                  )
                                }
                                onDelete={() =>
                                  handleDeleteSessionForWorktree(
                                    section.worktree.id,
                                    section.worktree.path,
                                    card.session.id
                                  )
                                }
                                onPlanView={() => handlePlanView(card)}
                                onRecapView={() => handleRecapView(card)}
                                onApprove={() => handlePlanApproval(card)}
                                onYolo={() => handlePlanApprovalYolo(card)}
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
      </div>

      {/* Plan Dialog */}
      {planDialogPath ? (
        <PlanDialog
          filePath={planDialogPath}
          isOpen={true}
          onClose={closePlanDialog}
          editable={true}
          approvalContext={planApprovalContext ?? undefined}
          onApprove={handleDialogApprove}
          onApproveYolo={handleDialogApproveYolo}
        />
      ) : planDialogContent ? (
        <PlanDialog
          content={planDialogContent}
          isOpen={true}
          onClose={closePlanDialog}
          editable={true}
          approvalContext={planApprovalContext ?? undefined}
          onApprove={handleDialogApprove}
          onApproveYolo={handleDialogApproveYolo}
        />
      ) : null}

      {/* Recap Dialog */}
      <RecapDialog
        digest={recapDialogDigest}
        isOpen={!!recapDialogDigest}
        onClose={closeRecapDialog}
      />

      {/* Session Chat Modal */}
      <SessionChatModal
        sessionId={selectedSession?.sessionId ?? null}
        worktreeId={selectedSession?.worktreeId ?? ''}
        worktreePath={selectedSession?.worktreePath ?? ''}
        isOpen={!!selectedSession}
        onClose={() => setSelectedSession(null)}
        onOpenFullView={handleOpenFullView}
      />

      {/* Keybinding hints */}
      {preferences?.show_keybinding_hints !== false && (
        <KeybindingHints
          hints={[
            { shortcut: 'Enter', label: 'open' },
            { shortcut: 'P', label: 'plan' },
            { shortcut: 'R', label: 'recap' },
            {
              shortcut: DEFAULT_KEYBINDINGS.new_worktree as string,
              label: 'new worktree',
            },
            {
              shortcut: DEFAULT_KEYBINDINGS.new_session as string,
              label: 'new session',
            },
            {
              shortcut: DEFAULT_KEYBINDINGS.close_session_or_worktree as string,
              label: 'close',
            },
          ]}
        />
      )}
    </div>
  )
}

interface EmptyDashboardProps {
  hasBaseSession: boolean
  onCreateWorktree: () => void
  onBaseSession: () => void
  isCreating: boolean
}

function EmptyDashboard({
  hasBaseSession,
  onCreateWorktree,
  onBaseSession,
  isCreating,
}: EmptyDashboardProps) {
  useEffect(() => {
    if (isCreating) return
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when typing in inputs or when a dialog/modal is open
      const tag = document.activeElement?.tagName
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        (document.activeElement as HTMLElement)?.isContentEditable
      )
        return

      const { projectSettingsDialogOpen } = useProjectsStore.getState()
      const {
        newWorktreeModalOpen,
        commandPaletteOpen,
        preferencesOpen,
        magicModalOpen,
      } = useUIStore.getState()
      if (
        projectSettingsDialogOpen ||
        newWorktreeModalOpen ||
        commandPaletteOpen ||
        preferencesOpen ||
        magicModalOpen
      )
        return

      const key = e.key.toLowerCase()
      if (key === 'b') {
        e.preventDefault()
        onBaseSession()
      } else if (key === 'n') {
        e.preventDefault()
        onCreateWorktree()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isCreating, onBaseSession, onCreateWorktree])

  return (
    <div className="flex h-full items-center justify-center">
      <div className="grid grid-cols-2 gap-6 w-full max-w-xl">
        <button
          onClick={onBaseSession}
          disabled={isCreating}
          className={cn(
            'relative flex flex-col items-center justify-center gap-4 aspect-square p-8 rounded-xl text-sm transition-colors',
            'hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring',
            'border border-border'
          )}
        >
          <GitBranch className="h-10 w-10 text-muted-foreground" />
          <div className="flex flex-col items-center gap-1.5">
            <span className="font-medium text-base">
              {hasBaseSession ? 'Switch to Base Session' : 'New Base Session'}
            </span>
            <span className="text-xs text-muted-foreground text-center">
              Work directly on the project folder
            </span>
          </div>
          <kbd className="absolute top-3 right-3 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            B
          </kbd>
        </button>

        <button
          onClick={onCreateWorktree}
          disabled={isCreating}
          className={cn(
            'relative flex flex-col items-center justify-center gap-4 aspect-square p-8 rounded-xl text-sm transition-colors',
            'hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring',
            'border border-border'
          )}
        >
          {isCreating ? (
            <Loader2 className="h-10 w-10 text-muted-foreground animate-spin" />
          ) : (
            <Plus className="h-10 w-10 text-muted-foreground" />
          )}
          <div className="flex flex-col items-center gap-1.5">
            <span className="font-medium text-base">New Worktree</span>
            <span className="text-xs text-muted-foreground text-center">
              Create an isolated branch for your task
            </span>
          </div>
          <kbd className="absolute top-3 right-3 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            N
          </kbd>
        </button>
      </div>
    </div>
  )
}
