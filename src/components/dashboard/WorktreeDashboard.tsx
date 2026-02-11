import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import { invoke } from '@/lib/transport'
import { Search, GitBranch, MoreHorizontal, Settings, Plus } from 'lucide-react'
import { WorktreeDropdownMenu } from '@/components/projects/WorktreeDropdownMenu'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
  useProjectBranches,
  useCreateWorktreeFromExistingBranch,
  projectsQueryKeys,
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
import { OpenPRsBadge } from '@/components/shared/OpenPRsBadge'
import { FailedRunsBadge } from '@/components/shared/FailedRunsBadge'
import { PlanDialog } from '@/components/chat/PlanDialog'
import { RecapDialog } from '@/components/chat/RecapDialog'
import { SessionChatModal } from '@/components/chat/SessionChatModal'
import { SessionCard } from '@/components/chat/SessionCard'
import {
  type SessionCardData,
  computeSessionCardData,
} from '@/components/chat/session-card-utils'
import { WorktreeSetupCard } from '@/components/chat/WorktreeSetupCard'
import {
  type TabId,
  SessionTabBar,
  QuickActionsTab,
  GitHubIssuesTab,
  GitHubPRsTab,
  BranchesTab,
} from '@/components/worktree/NewWorktreeModal'
import { useGhLogin } from '@/hooks/useGhLogin'
import {
  useGitHubIssues,
  useGitHubPRs,
  useSearchGitHubIssues,
  useSearchGitHubPRs,
  filterIssues,
  filterPRs,
  mergeWithSearchResults,
  githubQueryKeys,
} from '@/services/github'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import type {
  GitHubIssue,
  GitHubPullRequest,
  IssueContext,
  PullRequestContext,
} from '@/types/github'
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
        <span className="font-medium">
          {isBase ? 'Base Session' : worktree.name}
        </span>
        {(() => {
          const displayBranch = gitStatus?.current_branch ?? worktree.branch
          const displayName = isBase ? 'Base Session' : worktree.name
          return displayBranch !== displayName ? (
            <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
              <GitBranch className="h-3 w-3" />
              <span className="max-w-[150px] truncate">{displayBranch}</span>
            </span>
          ) : null
        })()}
        <GitStatusBadges
          behindCount={behindCount}
          unpushedCount={unpushedCount}
          diffAdded={diffAdded}
          diffRemoved={diffRemoved}
          onPull={handlePull}
          onPush={handlePush}
          onDiffClick={handleDiffClick}
        />
        <WorktreeDropdownMenu worktree={worktree} projectId={projectId} />
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

  // Auto-select session when dashboard opens (visual selection only, no modal)
  // Prefers the persisted active session per worktree, falls back to first card
  useEffect(() => {
    if (selectedIndex !== null || selectedSession) return
    if (flatCards.length === 0) return

    // Try to find a card matching a persisted active session
    const { activeSessionIds } = useChatStore.getState()
    let targetIndex = -1
    for (const fc of flatCards) {
      if (!fc.card || fc.isPending) continue
      const activeId = activeSessionIds[fc.worktreeId]
      if (activeId && fc.card.session.id === activeId) {
        targetIndex = fc.globalIndex
        break
      }
    }

    // Fall back to first non-pending card
    if (targetIndex === -1) {
      const firstCardIndex = flatCards.findIndex(
        fc => fc.card !== null && !fc.isPending
      )
      if (firstCardIndex === -1) return
      targetIndex = firstCardIndex
    }

    const targetCard = flatCards[targetIndex]
    setSelectedIndex(targetIndex)
    if (targetCard?.card) {
      useChatStore
        .getState()
        .setCanvasSelectedSession(
          targetCard.worktreeId,
          targetCard.card.session.id
        )
      // Sync projects store so commands (CMD+O, open terminal, etc.) work immediately
      useProjectsStore.getState().selectWorktree(targetCard.worktreeId)
      useChatStore
        .getState()
        .registerWorktreePath(targetCard.worktreeId, targetCard.worktreePath)
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
  const syncSelectionToStore = useCallback(
    (index: number) => {
      const item = flatCards[index]
      if (item) {
        // Sync projects store so CMD+O, CMD+M (magic modal), etc. use the correct worktree
        useProjectsStore.getState().selectWorktree(item.worktreeId)
        // Register worktree path so OpenInModal can find it
        useChatStore
          .getState()
          .registerWorktreePath(item.worktreeId, item.worktreePath)
      }
    },
    [flatCards]
  )

  // Keep selectedWorktreeId in sync whenever selectedIndex changes (click, keyboard, or external)
  // This fixes the bug where closing a session calls selectProject() which clears selectedWorktreeId,
  // but the dashboard still has a card selected via selectedIndex
  useEffect(() => {
    if (selectedIndex !== null) {
      syncSelectionToStore(selectedIndex)
    }
  }, [selectedIndex, syncSelectionToStore])

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
    isRecapDialogOpen,
    isGeneratingRecap,
    regenerateRecap,
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
    isRecapDialogOpen
  const { cardRefs } = useCanvasKeyboardNav({
    cards: flatCards,
    selectedIndex,
    onSelectedIndexChange: setSelectedIndex,
    onSelect: handleSelect,
    enabled: !isModalOpen,
    onSelectionChange: syncSelectionToStore,
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
            <OpenPRsBadge projectPath={project.path} projectId={projectId} />
            <FailedRunsBadge projectPath={project.path} />
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
                    window.dispatchEvent(new CustomEvent('create-new-worktree'))
                  }
                >
                  <Plus className="h-4 w-4" />
                  New Worktree
                </DropdownMenuItem>
                <DropdownMenuSeparator />
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
          {worktreeSections.length > 0 && (
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
          )}
        </div>

        {/* Canvas View */}
        <div
          className={`flex-1 pb-16 ${worktreeSections.length === 0 && !searchQuery ? '' : 'pt-6 px-4'}`}
        >
          {worktreeSections.length === 0 ? (
            searchQuery ? (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                No worktrees or sessions match your search
              </div>
            ) : (
              <EmptyDashboardTabs projectId={projectId} />
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
                    <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3">
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
        isOpen={isRecapDialogOpen}
        onClose={closeRecapDialog}
        isGenerating={isGeneratingRecap}
        onRegenerate={regenerateRecap}
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

function EmptyDashboardTabs({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient()
  const { triggerLogin: triggerGhLogin, isGhInstalled } = useGhLogin()

  const { data: projects = [] } = useProjects()
  const project = projects.find(p => p.id === projectId)
  const { data: worktrees = [] } = useWorktrees(projectId)
  const hasBaseSession = worktrees.some(wt => isBaseSession(wt))
  const baseSession = worktrees.find(wt => isBaseSession(wt))

  const [activeTab, setActiveTab] = useState<TabId>('quick')
  const [searchQuery, setTabSearchQuery] = useState('')
  const [includeClosed, setIncludeClosed] = useState(false)
  const [selectedItemIndex, setSelectedItemIndex] = useState(0)
  const [creatingFromNumber, setCreatingFromNumber] = useState<number | null>(
    null
  )
  const [creatingFromBranch, setCreatingFromBranch] = useState<string | null>(
    null
  )
  const searchInputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // GitHub issues
  const issueState = includeClosed ? 'all' : 'open'
  const {
    data: issueResult,
    isLoading: isLoadingIssues,
    isFetching: isRefetchingIssues,
    error: issuesError,
    refetch: refetchIssues,
  } = useGitHubIssues(project?.path ?? null, issueState)
  const issues = issueResult?.issues

  // GitHub PRs
  const prState = includeClosed ? 'all' : 'open'
  const {
    data: prs,
    isLoading: isLoadingPRs,
    isFetching: isRefetchingPRs,
    error: prsError,
    refetch: refetchPRs,
  } = useGitHubPRs(project?.path ?? null, prState)

  // Debounced search
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 300)
  const { data: searchedIssues, isFetching: isSearchingIssues } =
    useSearchGitHubIssues(project?.path ?? null, debouncedSearchQuery)
  const { data: searchedPRs, isFetching: isSearchingPRs } = useSearchGitHubPRs(
    project?.path ?? null,
    debouncedSearchQuery
  )

  const filteredIssues = useMemo(
    () =>
      mergeWithSearchResults(
        filterIssues(issues ?? [], searchQuery),
        searchedIssues
      ),
    [issues, searchQuery, searchedIssues]
  )

  const filteredPRs = useMemo(
    () =>
      mergeWithSearchResults(filterPRs(prs ?? [], searchQuery), searchedPRs),
    [prs, searchQuery, searchedPRs]
  )

  // Branches
  const {
    data: branches,
    isLoading: isLoadingBranches,
    isFetching: isRefetchingBranches,
    error: branchesError,
    refetch: refetchBranches,
  } = useProjectBranches(projectId)

  const filteredBranches = useMemo(() => {
    if (!branches) return []
    const baseBranch = project?.default_branch
    const filtered = branches.filter(b => b !== baseBranch)
    if (!searchQuery) return filtered
    const q = searchQuery.toLowerCase()
    return filtered.filter(b => b.toLowerCase().includes(q))
  }, [branches, searchQuery, project?.default_branch])

  // Mutations
  const createWorktree = useCreateWorktree()
  const createBaseSession = useCreateBaseSession()
  const createWorktreeFromBranch = useCreateWorktreeFromExistingBranch()

  // Invalidate caches on mount
  useEffect(() => {
    const projectPath = project?.path
    if (projectPath) {
      queryClient.invalidateQueries({
        queryKey: githubQueryKeys.issues(projectPath, 'open'),
      })
      queryClient.invalidateQueries({
        queryKey: githubQueryKeys.prs(projectPath, 'open'),
      })
    }
    if (projectId) {
      queryClient.invalidateQueries({
        queryKey: [...projectsQueryKeys.detail(projectId), 'branches'],
      })
    }
  }, [project?.path, projectId, queryClient])

  // Focus search input when switching to searchable tabs
  useEffect(() => {
    if (
      activeTab === 'issues' ||
      activeTab === 'prs' ||
      activeTab === 'branches'
    ) {
      const timer = setTimeout(() => searchInputRef.current?.focus(), 50)
      return () => clearTimeout(timer)
    }
  }, [activeTab])

  // Reset selection when switching tabs
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedItemIndex(0)
    setTabSearchQuery('')
  }, [activeTab])

  // Scroll selected item into view
  useEffect(() => {
    const el = document.querySelector(
      `[data-item-index="${selectedItemIndex}"]`
    )
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedItemIndex])

  const handleCreateWorktree = useCallback(() => {
    createWorktree.mutate({ projectId })
  }, [projectId, createWorktree])

  const handleBaseSession = useCallback(() => {
    if (hasBaseSession && baseSession) {
      const { selectWorktree } = useProjectsStore.getState()
      const { setActiveWorktree } = useChatStore.getState()
      selectWorktree(baseSession.id)
      setActiveWorktree(baseSession.id, baseSession.path)
      toast.success(`Switched to base session: ${baseSession.name}`)
    } else {
      createBaseSession.mutate(projectId)
    }
  }, [projectId, hasBaseSession, baseSession, createBaseSession])

  const handleSelectBranch = useCallback(
    (branchName: string) => {
      setCreatingFromBranch(branchName)
      createWorktreeFromBranch.mutate(
        { projectId, branchName },
        { onError: () => setCreatingFromBranch(null) }
      )
    },
    [projectId, createWorktreeFromBranch]
  )

  const handleSelectIssue = useCallback(
    async (issue: GitHubIssue) => {
      const projectPath = project?.path
      if (!projectPath) return
      setCreatingFromNumber(issue.number)
      try {
        const issueDetail = await invoke<
          GitHubIssue & {
            comments: {
              body: string
              author: { login: string }
              created_at: string
            }[]
          }
        >('get_github_issue', { projectPath, issueNumber: issue.number })
        const issueContext: IssueContext = {
          number: issueDetail.number,
          title: issueDetail.title,
          body: issueDetail.body,
          comments: (issueDetail.comments ?? [])
            .filter(c => c && c.created_at && c.author)
            .map(c => ({
              body: c.body ?? '',
              author: { login: c.author.login ?? '' },
              createdAt: c.created_at,
            })),
        }
        createWorktree.mutate({ projectId, issueContext })
      } catch (error) {
        toast.error(`Failed to fetch issue details: ${error}`)
        setCreatingFromNumber(null)
      }
    },
    [projectId, project, createWorktree]
  )

  const handleSelectIssueAndInvestigate = useCallback(
    async (issue: GitHubIssue) => {
      const projectPath = project?.path
      if (!projectPath) return
      setCreatingFromNumber(issue.number)
      try {
        const issueDetail = await invoke<
          GitHubIssue & {
            comments: {
              body: string
              author: { login: string }
              created_at: string
            }[]
          }
        >('get_github_issue', { projectPath, issueNumber: issue.number })
        const issueContext: IssueContext = {
          number: issueDetail.number,
          title: issueDetail.title,
          body: issueDetail.body,
          comments: (issueDetail.comments ?? [])
            .filter(c => c && c.created_at && c.author)
            .map(c => ({
              body: c.body ?? '',
              author: { login: c.author.login ?? '' },
              createdAt: c.created_at,
            })),
        }
        const pendingWorktree = await createWorktree.mutateAsync({
          projectId,
          issueContext,
        })
        const { markWorktreeForAutoInvestigate } = useUIStore.getState()
        markWorktreeForAutoInvestigate(pendingWorktree.id)
      } catch (error) {
        toast.error(`Failed to fetch issue details: ${error}`)
        setCreatingFromNumber(null)
      }
    },
    [projectId, project, createWorktree]
  )

  const handleSelectPR = useCallback(
    async (pr: GitHubPullRequest) => {
      const projectPath = project?.path
      if (!projectPath) return
      setCreatingFromNumber(pr.number)
      try {
        const prDetail = await invoke<
          GitHubPullRequest & {
            comments: {
              body: string
              author: { login: string }
              created_at: string
            }[]
            reviews: {
              body: string
              state: string
              author: { login: string }
              submittedAt?: string
            }[]
          }
        >('get_github_pr', { projectPath, prNumber: pr.number })
        const prContext: PullRequestContext = {
          number: prDetail.number,
          title: prDetail.title,
          body: prDetail.body,
          headRefName: prDetail.headRefName,
          baseRefName: prDetail.baseRefName,
          comments: (prDetail.comments ?? [])
            .filter(c => c && c.created_at && c.author)
            .map(c => ({
              body: c.body ?? '',
              author: { login: c.author.login ?? '' },
              createdAt: c.created_at,
            })),
          reviews: (prDetail.reviews ?? [])
            .filter(r => r && r.author)
            .map(r => ({
              body: r.body ?? '',
              state: r.state,
              author: { login: r.author.login ?? '' },
              submittedAt: r.submittedAt,
            })),
        }
        createWorktree.mutate({ projectId, prContext })
      } catch (error) {
        toast.error(`Failed to fetch PR details: ${error}`)
        setCreatingFromNumber(null)
      }
    },
    [projectId, project, createWorktree]
  )

  const handleSelectPRAndInvestigate = useCallback(
    async (pr: GitHubPullRequest) => {
      const projectPath = project?.path
      if (!projectPath) return
      setCreatingFromNumber(pr.number)
      try {
        const prDetail = await invoke<
          GitHubPullRequest & {
            comments: {
              body: string
              author: { login: string }
              created_at: string
            }[]
            reviews: {
              body: string
              state: string
              author: { login: string }
              submittedAt?: string
            }[]
          }
        >('get_github_pr', { projectPath, prNumber: pr.number })
        const prContext: PullRequestContext = {
          number: prDetail.number,
          title: prDetail.title,
          body: prDetail.body,
          headRefName: prDetail.headRefName,
          baseRefName: prDetail.baseRefName,
          comments: (prDetail.comments ?? [])
            .filter(c => c && c.created_at && c.author)
            .map(c => ({
              body: c.body ?? '',
              author: { login: c.author.login ?? '' },
              createdAt: c.created_at,
            })),
          reviews: (prDetail.reviews ?? [])
            .filter(r => r && r.author)
            .map(r => ({
              body: r.body ?? '',
              state: r.state,
              author: { login: r.author.login ?? '' },
              submittedAt: r.submittedAt,
            })),
        }
        const pendingWorktree = await createWorktree.mutateAsync({
          projectId,
          prContext,
        })
        const { markWorktreeForAutoInvestigatePR } = useUIStore.getState()
        markWorktreeForAutoInvestigatePR(pendingWorktree.id)
      } catch (error) {
        toast.error(`Failed to fetch PR details: ${error}`)
        setCreatingFromNumber(null)
      }
    },
    [projectId, project, createWorktree]
  )

  // Keyboard navigation (document-level so it works regardless of focus)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()

      // Tab shortcuts (Cmd+key)
      if (e.metaKey || e.ctrlKey) {
        if (key === '1') {
          e.preventDefault()
          setActiveTab('quick')
          return
        }
        if (key === '2') {
          e.preventDefault()
          setActiveTab('issues')
          return
        }
        if (key === '3') {
          e.preventDefault()
          setActiveTab('prs')
          return
        }
        if (key === '4') {
          e.preventDefault()
          setActiveTab('branches')
          return
        }
      }

      // Skip single-key shortcuts when typing in an input
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      // Quick actions shortcuts
      if (activeTab === 'quick') {
        if (key === 'n') {
          e.preventDefault()
          e.stopImmediatePropagation()
          handleCreateWorktree()
          return
        }
        if (key === 'm') {
          e.preventDefault()
          e.stopImmediatePropagation()
          handleBaseSession()
          return
        }
      }

      // Issues tab navigation
      if (activeTab === 'issues' && filteredIssues.length > 0) {
        if (key === 'arrowdown') {
          e.preventDefault()
          setSelectedItemIndex(prev =>
            Math.min(prev + 1, filteredIssues.length - 1)
          )
          return
        }
        if (key === 'arrowup') {
          e.preventDefault()
          setSelectedItemIndex(prev => Math.max(prev - 1, 0))
          return
        }
        if (key === 'enter' && filteredIssues[selectedItemIndex]) {
          e.preventDefault()
          handleSelectIssue(filteredIssues[selectedItemIndex])
          return
        }
        if (key === 'm' && filteredIssues[selectedItemIndex]) {
          e.preventDefault()
          handleSelectIssueAndInvestigate(filteredIssues[selectedItemIndex])
          return
        }
      }

      // PRs tab navigation
      if (activeTab === 'prs' && filteredPRs.length > 0) {
        if (key === 'arrowdown') {
          e.preventDefault()
          setSelectedItemIndex(prev =>
            Math.min(prev + 1, filteredPRs.length - 1)
          )
          return
        }
        if (key === 'arrowup') {
          e.preventDefault()
          setSelectedItemIndex(prev => Math.max(prev - 1, 0))
          return
        }
        if (key === 'enter' && filteredPRs[selectedItemIndex]) {
          e.preventDefault()
          handleSelectPR(filteredPRs[selectedItemIndex])
          return
        }
        if (key === 'm' && filteredPRs[selectedItemIndex]) {
          e.preventDefault()
          handleSelectPRAndInvestigate(filteredPRs[selectedItemIndex])
          return
        }
      }

      // Branches tab navigation
      if (activeTab === 'branches' && filteredBranches.length > 0) {
        if (key === 'arrowdown') {
          e.preventDefault()
          setSelectedItemIndex(prev =>
            Math.min(prev + 1, filteredBranches.length - 1)
          )
          return
        }
        if (key === 'arrowup') {
          e.preventDefault()
          setSelectedItemIndex(prev => Math.max(prev - 1, 0))
          return
        }
        if (key === 'enter' && filteredBranches[selectedItemIndex]) {
          e.preventDefault()
          handleSelectBranch(filteredBranches[selectedItemIndex])
          return
        }
      }
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [
    activeTab,
    filteredIssues,
    filteredPRs,
    filteredBranches,
    selectedItemIndex,
    handleCreateWorktree,
    handleBaseSession,
    handleSelectIssue,
    handleSelectIssueAndInvestigate,
    handleSelectPR,
    handleSelectPRAndInvestigate,
    handleSelectBranch,
  ])

  return (
    <div
      ref={containerRef}
      className="flex flex-col h-full w-full"
    >
      <SessionTabBar activeTab={activeTab} onTabChange={setActiveTab} />
      <div className="flex-1 min-h-0 flex flex-col">
        {activeTab === 'quick' && (
          <QuickActionsTab
            hasBaseSession={hasBaseSession}
            onCreateWorktree={handleCreateWorktree}
            onBaseSession={handleBaseSession}
            isCreating={createWorktree.isPending || createBaseSession.isPending}
          />
        )}
        {activeTab === 'issues' && (
          <GitHubIssuesTab
            searchQuery={searchQuery}
            setSearchQuery={setTabSearchQuery}
            includeClosed={includeClosed}
            setIncludeClosed={setIncludeClosed}
            issues={filteredIssues}
            isLoading={isLoadingIssues}
            isRefetching={isRefetchingIssues}
            isSearching={isSearchingIssues}
            error={issuesError}
            onRefresh={() => refetchIssues()}
            selectedIndex={selectedItemIndex}
            setSelectedIndex={setSelectedItemIndex}
            onSelectIssue={handleSelectIssue}
            onInvestigateIssue={handleSelectIssueAndInvestigate}
            creatingFromNumber={creatingFromNumber}
            searchInputRef={searchInputRef}
            onGhLogin={triggerGhLogin}
            isGhInstalled={isGhInstalled}
          />
        )}
        {activeTab === 'prs' && (
          <GitHubPRsTab
            searchQuery={searchQuery}
            setSearchQuery={setTabSearchQuery}
            includeClosed={includeClosed}
            setIncludeClosed={setIncludeClosed}
            prs={filteredPRs}
            isLoading={isLoadingPRs}
            isRefetching={isRefetchingPRs}
            isSearching={isSearchingPRs}
            error={prsError}
            onRefresh={() => refetchPRs()}
            selectedIndex={selectedItemIndex}
            setSelectedIndex={setSelectedItemIndex}
            onSelectPR={handleSelectPR}
            onInvestigatePR={handleSelectPRAndInvestigate}
            creatingFromNumber={creatingFromNumber}
            searchInputRef={searchInputRef}
            onGhLogin={triggerGhLogin}
            isGhInstalled={isGhInstalled}
          />
        )}
        {activeTab === 'branches' && (
          <BranchesTab
            searchQuery={searchQuery}
            setSearchQuery={setTabSearchQuery}
            branches={filteredBranches}
            isLoading={isLoadingBranches}
            isRefetching={isRefetchingBranches}
            error={branchesError}
            onRefresh={() => refetchBranches()}
            selectedIndex={selectedItemIndex}
            setSelectedIndex={setSelectedItemIndex}
            onSelectBranch={handleSelectBranch}
            creatingFromBranch={creatingFromBranch}
            searchInputRef={searchInputRef}
          />
        )}
      </div>
    </div>
  )
}
