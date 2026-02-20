import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react'
import { useQueries } from '@tanstack/react-query'
import { invoke } from '@/lib/transport'
import { cn } from '@/lib/utils'
import {
  Search,
  MoreHorizontal,
  Settings,
  Plus,
  FileJson,
  LayoutGrid,
  List,
} from 'lucide-react'
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
  useJeanConfig,
  isTauri,
} from '@/services/projects'
import {
  chatQueryKeys,
  useCreateSession,
  cancelChatMessage,
} from '@/services/chat'
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
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { LabelModal } from '@/components/chat/LabelModal'
import {
  type SessionCardData,
  computeSessionCardData,
  groupCardsByStatus,
  flattenGroups,
} from '@/components/chat/session-card-utils'
import { WorktreeSetupCard } from '@/components/chat/WorktreeSetupCard'
import { OpenInButton } from '@/components/open-in/OpenInButton'
import { useCanvasStoreState } from '@/components/chat/hooks/useCanvasStoreState'
import { usePlanApproval } from '@/components/chat/hooks/usePlanApproval'
import { useCanvasKeyboardNav } from '@/components/chat/hooks/useCanvasKeyboardNav'
import { useCanvasShortcutEvents } from '@/components/chat/hooks/useCanvasShortcutEvents'
import {
  useArchiveWorktree,
  useDeleteWorktree,
  useCloseBaseSessionClean,
  useCloseBaseSessionArchive,
} from '@/services/projects'
import { useArchiveSession, useCloseSession } from '@/services/chat'
import { usePreferences, useSavePreferences } from '@/services/preferences'
import { KeybindingHints } from '@/components/ui/keybinding-hints'
import { DEFAULT_KEYBINDINGS, formatShortcutDisplay } from '@/types/keybindings'
import { CloseWorktreeDialog } from '@/components/chat/CloseWorktreeDialog'
const GitDiffModal = lazy(() =>
  import('@/components/chat/GitDiffModal').then(mod => ({
    default: mod.GitDiffModal,
  }))
)
import type { DiffRequest } from '@/types/git-diff'
import { toast } from 'sonner'
import { useTerminalStore } from '@/store/terminal-store'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  gitPush,
  fetchWorktreesStatus,
  triggerImmediateGitPoll,
  performGitPull,
} from '@/services/git-status'

interface ProjectCanvasViewProps {
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

type ActiveStatus =
  | 'waiting'
  | 'planning'
  | 'vibing'
  | 'yoloing'
  | 'review'
  | null

function getActiveStatus(cards: SessionCardData[]): ActiveStatus {
  if (cards.some(c => c.status === 'waiting' || c.status === 'permission'))
    return 'waiting'
  if (cards.some(c => c.status === 'yoloing')) return 'yoloing'
  if (cards.some(c => c.status === 'vibing')) return 'vibing'
  if (cards.some(c => c.status === 'planning')) return 'planning'
  if (cards.some(c => c.status === 'review' || c.status === 'completed'))
    return 'review'
  return null
}

function WorktreeSectionHeader({
  worktree,
  projectId,
  defaultBranch,
  sessionSummary,
  activeStatus,
  isSelected,
  onRowClick,
}: {
  worktree: Worktree
  projectId: string
  defaultBranch: string
  sessionSummary?: string
  activeStatus?: ActiveStatus
  isSelected?: boolean
  onRowClick?: () => void
}) {
  const isBase = isBaseSession(worktree)
  const { data: gitStatus } = useGitStatus(worktree.id)
  const [diffRequest, setDiffRequest] = useState<DiffRequest | null>(null)
  const hasRunningTerminal = useTerminalStore(state => {
    const terminals = state.terminals[worktree.id] ?? []
    return terminals.some(t => state.runningTerminals.has(t.id))
  })

  const behindCount =
    gitStatus?.behind_count ?? worktree.cached_behind_count ?? 0
  const unpushedCount =
    gitStatus?.unpushed_count ?? worktree.cached_unpushed_count ?? 0

  // Diff stats: branch diff + uncommitted for non-base; uncommitted only for base
  const branchDiffAdded =
    gitStatus?.branch_diff_added ?? worktree.cached_branch_diff_added ?? 0
  const branchDiffRemoved =
    gitStatus?.branch_diff_removed ?? worktree.cached_branch_diff_removed ?? 0
  const uncommittedAdded =
    gitStatus?.uncommitted_added ?? worktree.cached_uncommitted_added ?? 0
  const uncommittedRemoved =
    gitStatus?.uncommitted_removed ?? worktree.cached_uncommitted_removed ?? 0
  const diffAdded = isBase
    ? uncommittedAdded
    : branchDiffAdded + uncommittedAdded
  const diffRemoved = isBase
    ? uncommittedRemoved
    : branchDiffRemoved + uncommittedRemoved

  const handlePull = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      await performGitPull({
        worktreeId: worktree.id,
        worktreePath: worktree.path,
        baseBranch: defaultBranch,
        projectId,
      })
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
      <div
        className={cn(
          'mb-0.5 flex items-center gap-2 border border-transparent transition-colors',
          onRowClick && 'cursor-pointer px-2 -mx-2 py-1 hover:bg-muted/50',
          isSelected && onRowClick && 'bg-primary/5 border-primary/50'
        )}
        onClick={onRowClick}
        role={onRowClick ? 'button' : undefined}
      >
        {hasRunningTerminal && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="shrink-0 block h-3 w-3 square-spinner" />
            </TooltipTrigger>
            <TooltipContent>
              Dev server running in terminal. Press ⌘R to open
            </TooltipContent>
          </Tooltip>
        )}
        <span className="inline-flex items-center gap-1.5 font-medium">
          {isBase ? 'Base Session' : worktree.name}
          {(() => {
            const displayBranch = gitStatus?.current_branch ?? worktree.branch
            const displayName = isBase ? 'Base Session' : worktree.name
            return displayBranch && displayBranch !== displayName ? (
              <span className="text-xs leading-none font-normal text-muted-foreground">
                · {displayBranch}
              </span>
            ) : null
          })()}
          <span
            className="inline-flex items-center font-normal"
            onClick={e => e.stopPropagation()}
          >
            <GitStatusBadges
              behindCount={behindCount}
              unpushedCount={unpushedCount}
              diffAdded={diffAdded}
              diffRemoved={diffRemoved}
              onPull={handlePull}
              onPush={handlePush}
              onDiffClick={handleDiffClick}
            />
          </span>
        </span>
        {sessionSummary && (
          <span
            className={cn(
              'ml-auto text-xs font-medium px-1.5 text-muted-foreground py-0.5 rounded',
              activeStatus === 'waiting' && 'bg-yellow-400 text-black',
              (activeStatus === 'planning' || activeStatus === 'vibing' || activeStatus === 'review' || activeStatus === 'yoloing') && 'bg-green-600 text-white',

            )}
          >
            {sessionSummary}
          </span>
        )}
      </div >
      <Suspense fallback={null}>
        <GitDiffModal
          diffRequest={diffRequest}
          onClose={() => setDiffRequest(null)}
          uncommittedStats={{
            added: uncommittedAdded,
            removed: uncommittedRemoved,
          }}
          branchStats={{ added: branchDiffAdded, removed: branchDiffRemoved }}
        />
      </Suspense>
    </>
  )
}

export function ProjectCanvasView({ projectId }: ProjectCanvasViewProps) {
  // Preferences for keybinding hints and layout
  const { data: preferences } = usePreferences()
  const savePreferences = useSavePreferences()
  const canvasLayout = preferences?.canvas_layout ?? 'grid'
  const isListLayout = canvasLayout === 'list'

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

  // Derive a stable fingerprint from query data to avoid re-computing
  // sessionsByWorktreeId when useQueries returns a new array with same data.
  const sessionsFingerprint = sessionQueries
    .map(q => `${q.data?.worktree_id}:${q.dataUpdatedAt}:${q.isLoading}`)
    .join('|')

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionsFingerprint])

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

      // Base sessions are always visible (not searchable)
      const isBase = isBaseSession(worktree)

      // Filter sessions based on search query
      const filteredSessions =
        searchQuery.trim() && !isBase
          ? sessions.filter(
            session =>
              session.name
                .toLowerCase()
                .includes(searchQuery.toLowerCase()) ||
              worktree.name
                .toLowerCase()
                .includes(searchQuery.toLowerCase()) ||
              worktree.branch
                .toLowerCase()
                .includes(searchQuery.toLowerCase())
          )
          : sessions

      // Compute card data for each session
      const cards = filteredSessions.map(session =>
        computeSessionCardData(session, storeState)
      )

      // Sort: labeled first, grouped by label name, then unlabeled
      cards.sort((a, b) => {
        if (a.label && !b.label) return -1
        if (!a.label && b.label) return 1
        if (a.label && b.label) return a.label.name.localeCompare(b.label.name)
        return 0
      })

      // Re-order by status group so flat array matches visual group order
      const grouped = flattenGroups(groupCardsByStatus(cards))

      // Only include worktrees that have sessions (after filtering)
      if (grouped.length > 0) {
        result.push({ worktree, cards: grouped })
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

  // Compute session summary for worktree rows (list view)
  const getSessionSummary = useCallback((cards: SessionCardData[]): string => {
    const groups = groupCardsByStatus(cards)
    return groups
      .map(g => `${g.cards.length} ${g.title.toLowerCase()}`)
      .join(' · ')

  }, [])

  // Build flat array of all cards for keyboard navigation
  const flatCards: FlatCard[] = useMemo(() => {
    const result: FlatCard[] = []
    let globalIndex = 0
    for (const section of worktreeSections) {
      if (isListLayout) {
        // List view: one entry per worktree
        result.push({
          worktreeId: section.worktree.id,
          worktreePath: section.worktree.path,
          card: section.cards[0] ?? null,
          globalIndex,
          isPending: section.isPending,
        })
        globalIndex++
      } else if (section.isPending) {
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
  }, [worktreeSections, isListLayout])

  // Selection state
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [selectedWorktreeModal, setSelectedWorktreeModal] = useState<{
    worktreeId: string
    worktreePath: string
  } | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  // Track highlighted card to survive reordering
  const highlightedCardRef = useRef<{
    worktreeId: string
    sessionId: string
  } | null>(null)

  // Worktree close confirmation (CMD+W on canvas)
  const [closeWorktreeTarget, setCloseWorktreeTarget] = useState<{
    worktreeId: string
    branchName?: string
  } | null>(null)

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
  const deleteWorktree = useDeleteWorktree()
  const closeBaseSessionClean = useCloseBaseSessionClean()
  const closeBaseSessionArchive = useCloseBaseSessionArchive()

  const closeWorktreeDirectly = useCallback(
    (worktreeId: string) => {
      if (!project) return
      const wt = visibleWorktrees.find(w => w.id === worktreeId)
      if (!wt) return
      if (isBaseSession(wt)) {
        if (preferences?.removal_behavior === 'delete') {
          closeBaseSessionClean.mutate({
            worktreeId: wt.id,
            projectId: project.id,
          })
        } else {
          closeBaseSessionArchive.mutate({
            worktreeId: wt.id,
            projectId: project.id,
          })
        }
      } else if (preferences?.removal_behavior === 'delete') {
        deleteWorktree.mutate({ worktreeId: wt.id, projectId: project.id })
      } else {
        archiveWorktree.mutate({ worktreeId: wt.id, projectId: project.id })
      }
    },
    [
      project,
      visibleWorktrees,
      preferences?.removal_behavior,
      archiveWorktree,
      deleteWorktree,
      closeBaseSessionClean,
      closeBaseSessionArchive,
    ]
  )

  const handleConfirmCloseWorktree = useCallback(() => {
    if (!closeWorktreeTarget) return
    closeWorktreeDirectly(closeWorktreeTarget.worktreeId)
    setCloseWorktreeTarget(null)
  }, [closeWorktreeTarget, closeWorktreeDirectly])

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
        !!selectedWorktreeModal,
        selectedWorktreeModal?.worktreeId ?? null
      )
  }, [selectedWorktreeModal])

  // Record last opened worktree+session per project for restoration on project switch
  const activeSessionIdForModal = useChatStore(
    state => selectedWorktreeModal ? state.activeSessionIds[selectedWorktreeModal.worktreeId] : undefined
  )
  useEffect(() => {
    if (!selectedWorktreeModal || !activeSessionIdForModal) return
    useChatStore
      .getState()
      .setLastOpenedForProject(
        projectId,
        selectedWorktreeModal.worktreeId,
        activeSessionIdForModal
      )
  }, [projectId, selectedWorktreeModal, activeSessionIdForModal])

  // Track highlighted card when selectedIndex changes (for surviving reorders)
  const handleSelectedIndexChange = useCallback(
    (index: number | null) => {
      setSelectedIndex(index)
      if (index !== null && flatCards[index]?.card) {
        highlightedCardRef.current = {
          worktreeId: flatCards[index].worktreeId,
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          sessionId: flatCards[index].card!.session.id,
        }
      }
    },
    [flatCards]
  )

  // Re-sync selectedIndex when flatCards reorders (status changes, etc.)
  useEffect(() => {
    const highlighted = selectedWorktreeModal
      ? { worktreeId: selectedWorktreeModal.worktreeId }
      : highlightedCardRef.current
    if (!highlighted) return
    const cardIndex = isListLayout
      ? flatCards.findIndex(fc => fc.worktreeId === highlighted.worktreeId)
      : flatCards.findIndex(
        fc =>
          fc.worktreeId === highlighted.worktreeId &&
          ('sessionId' in highlighted
            ? fc.card?.session.id === highlighted.sessionId
            : true)
      )
    if (cardIndex !== -1 && cardIndex !== selectedIndex) {
      setSelectedIndex(cardIndex)
    }
  }, [selectedWorktreeModal, flatCards, selectedIndex, isListLayout])

  // Auto-open session modal for newly created worktrees
  useEffect(() => {
    for (const [worktreeId, sessionData] of sessionsByWorktreeId) {
      if (!sessionData.sessions.length) continue

      const autoOpen = useUIStore.getState().consumeAutoOpenSession(worktreeId)
      if (!autoOpen.shouldOpen) continue

      const worktree = readyWorktrees.find(w => w.id === worktreeId)
      // Use specific session if provided, otherwise fall back to first session
      const targetSessionId = autoOpen.sessionId
      const targetSession = targetSessionId
        ? sessionData.sessions.find(s => s.id === targetSessionId)
        : sessionData.sessions[0]

      // If requested session hasn't arrived in this query yet, re-queue and retry later.
      if (targetSessionId && !targetSession) {
        useUIStore
          .getState()
          .markWorktreeForAutoOpenSession(worktreeId, targetSessionId)
        continue
      }

      if (worktree && targetSession) {
        // Find the index in flatCards for keyboard selection
        const cardIndex = flatCards.findIndex(
          fc =>
            fc.worktreeId === worktreeId &&
            fc.card?.session.id === targetSession.id
        )
        if (cardIndex !== -1) {
          setSelectedIndex(cardIndex)
          highlightedCardRef.current = {
            worktreeId,
            sessionId: targetSession.id,
          }
        }

        // Set active session so the modal opens on the right tab
        useChatStore.getState().setActiveSession(worktreeId, targetSession.id)
        setSelectedWorktreeModal({
          worktreeId,
          worktreePath: worktree.path,
        })
        break // Only one per render cycle
      }
    }
  }, [sessionsByWorktreeId, readyWorktrees, flatCards])

  // Auto-select session when dashboard opens (visual selection only, no modal unless restore_last_session is on)
  // Prefers last opened per project, then persisted active session per worktree, falls back to first card
  useEffect(() => {
    if (selectedIndex !== null || selectedWorktreeModal) return
    if (flatCards.length === 0) return

    const { activeSessionIds, lastActiveWorktreeId, lastOpenedPerProject } = useChatStore.getState()
    let targetIndex = -1
    let shouldAutoOpenModal = false

    // First: check lastOpenedPerProject for this project
    const lastOpened = lastOpenedPerProject[projectId]
    if (lastOpened) {
      for (const fc of flatCards) {
        if (!fc.card || fc.isPending) continue
        if (
          fc.worktreeId === lastOpened.worktreeId &&
          fc.card.session.id === lastOpened.sessionId
        ) {
          targetIndex = fc.globalIndex
          // Auto-open modal if restore_last_session is enabled
          if (preferences?.restore_last_session) {
            shouldAutoOpenModal = true
          }
          break
        }
      }
    }

    // Second: check the last active worktree's session
    if (targetIndex === -1 && lastActiveWorktreeId) {
      const lastActiveSessionId = activeSessionIds[lastActiveWorktreeId]
      if (lastActiveSessionId) {
        for (const fc of flatCards) {
          if (!fc.card || fc.isPending) continue
          if (
            fc.worktreeId === lastActiveWorktreeId &&
            fc.card.session.id === lastActiveSessionId
          ) {
            targetIndex = fc.globalIndex
            break
          }
        }
      }
    }

    // Fallback: check any worktree's persisted active session
    if (targetIndex === -1) {
      for (const fc of flatCards) {
        if (!fc.card || fc.isPending) continue
        const activeId = activeSessionIds[fc.worktreeId]
        if (activeId && fc.card.session.id === activeId) {
          targetIndex = fc.globalIndex
          break
        }
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

      // Auto-open SessionChatModal if restore_last_session is enabled
      if (shouldAutoOpenModal) {
        useChatStore
          .getState()
          .setActiveSession(targetCard.worktreeId, targetCard.card.session.id)
        setSelectedWorktreeModal({
          worktreeId: targetCard.worktreeId,
          worktreePath: targetCard.worktreePath,
        })
      }
    }
  }, [flatCards, selectedIndex, selectedWorktreeModal, projectId, preferences?.restore_last_session])

  // Sync selection to store for cancel shortcut - updates when user navigates with arrow keys
  useEffect(() => {
    if (selectedWorktreeModal?.worktreeId) {
      const activeSessionId =
        useChatStore.getState().activeSessionIds[
        selectedWorktreeModal.worktreeId
        ]
      if (activeSessionId) {
        useChatStore
          .getState()
          .setCanvasSelectedSession(
            selectedWorktreeModal.worktreeId,
            activeSessionId
          )
      }
    }
  }, [selectedWorktreeModal?.worktreeId])

  // Mutations
  const createSession = useCreateSession()

  // Handle clicking on a worktree row - open modal
  const handleWorktreeClick = useCallback(
    (worktreeId: string, worktreePath: string) => {
      setSelectedWorktreeModal({ worktreeId, worktreePath })
    },
    []
  )

  // Handle selection from keyboard nav
  const handleSelect = useCallback(
    (index: number) => {
      const item = flatCards[index]
      if (item && !item.isPending) {
        handleWorktreeClick(item.worktreeId, item.worktreePath)
      }
    },
    [flatCards, handleWorktreeClick]
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

  // Cancel running session via cancel-prompt event (dispatched by centralized keybinding system)
  useEffect(() => {
    const handleCancelPrompt = () => {
      // Skip when session modal is open — ChatWindow handles it in that case
      if (useUIStore.getState().sessionChatModalOpen) return

      if (!selectedFlatCard?.card) return
      const sessionId = selectedFlatCard.card.session.id
      const worktreeId = selectedFlatCard.worktreeId
      const isSending =
        useChatStore.getState().sendingSessionIds[sessionId] ?? false
      if (isSending) {
        cancelChatMessage(sessionId, worktreeId)
      }
    }

    window.addEventListener('cancel-prompt', handleCancelPrompt)
    return () => window.removeEventListener('cancel-prompt', handleCancelPrompt)
  }, [selectedFlatCard])

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
    isLabelModalOpen,
    labelModalSessionId,
    labelModalCurrentLabel,
    closeLabelModal,
    handleOpenLabelModal,
  } = useCanvasShortcutEvents({
    selectedCard,
    enabled: !selectedWorktreeModal && selectedIndex !== null,
    worktreeId: selectedFlatCard?.worktreeId ?? '',
    worktreePath: selectedFlatCard?.worktreePath ?? '',
    onPlanApproval: (card, updatedPlan) =>
      handlePlanApproval(card, updatedPlan),
    onPlanApprovalYolo: (card, updatedPlan) =>
      handlePlanApprovalYolo(card, updatedPlan),
  })

  // Keyboard navigation - disable when any modal/dialog is open
  const isModalOpen =
    !!selectedWorktreeModal ||
    !!planDialogPath ||
    !!planDialogContent ||
    isRecapDialogOpen ||
    isLabelModalOpen
  const { cardRefs } = useCanvasKeyboardNav({
    cards: flatCards,
    selectedIndex,
    onSelectedIndexChange: handleSelectedIndexChange,
    onSelect: handleSelect,
    enabled: !isModalOpen,
    layout: canvasLayout,
    onSelectionChange: syncSelectionToStore,
  })

  // Handle approve from dialog (with updated plan content)
  const handleDialogApprove = useCallback(
    (updatedPlan: string) => {
      if (planDialogCard) {
        handlePlanApproval(planDialogCard, updatedPlan)
      }
    },
    [planDialogCard, handlePlanApproval]
  )

  const handleDialogApproveYolo = useCallback(
    (updatedPlan: string) => {
      if (planDialogCard) {
        handlePlanApprovalYolo(planDialogCard, updatedPlan)
      }
    },
    [planDialogCard, handlePlanApprovalYolo]
  )

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

  // Handle delete session for a specific worktree (respects removal_behavior preference)
  const removalBehavior = preferences?.removal_behavior ?? 'archive'
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
        } else if (removalBehavior === 'delete') {
          deleteWorktree.mutate({
            worktreeId,
            projectId: project.id,
          })
        } else {
          archiveWorktree.mutate({
            worktreeId,
            projectId: project.id,
          })
        }
      } else if (removalBehavior === 'delete') {
        closeSession.mutate({
          worktreeId,
          worktreePath,
          sessionId,
        })
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
      removalBehavior,
      closeSession,
      archiveSession,
      archiveWorktree,
      deleteWorktree,
      closeBaseSessionClean,
    ]
  )

  // Listen for close-session-or-worktree event to handle CMD+W
  useEffect(() => {
    const handleCloseSessionOrWorktree = (e: Event) => {
      // If modal is open, SessionChatModal intercepts CMD+W — let it handle
      if (selectedWorktreeModal) return

      // Consume the event to prevent the legacy useCloseSessionOrWorktreeKeybinding fallback
      e.stopImmediatePropagation()

      // No modal open — close the worktree of the selected card
      if (selectedIndex !== null && flatCards[selectedIndex]) {
        const item = flatCards[selectedIndex]
        if (!item.card) return // pending worktree, skip

        if (preferences?.confirm_session_close === false) {
          closeWorktreeDirectly(item.worktreeId)
        } else {
          const wt = worktreeSections.find(
            s => s.worktree.id === item.worktreeId
          )?.worktree
          setCloseWorktreeTarget({
            worktreeId: item.worktreeId,
            branchName: wt?.branch,
          })
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
    selectedWorktreeModal,
    selectedIndex,
    flatCards,
    worktreeSections,
    preferences?.confirm_session_close,
    closeWorktreeDirectly,
  ])

  // Listen for create-new-session event to handle CMD+T
  useEffect(() => {
    const handleCreateNewSession = (e: Event) => {
      // Don't create if modal is already open
      if (selectedWorktreeModal) return

      // Use selected card, or fallback to first card
      const item =
        selectedIndex !== null ? flatCards[selectedIndex] : flatCards[0]
      if (!item) return

      e.stopImmediatePropagation()

      createSession.mutate(
        { worktreeId: item.worktreeId, worktreePath: item.worktreePath },
        {
          onSuccess: session => {
            // Update highlighted ref so canvas stays on new session after modal close
            highlightedCardRef.current = {
              worktreeId: item.worktreeId,
              sessionId: session.id,
            }
            useChatStore
              .getState()
              .setActiveSession(item.worktreeId, session.id)
            setSelectedWorktreeModal({
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
  }, [selectedWorktreeModal, selectedIndex, flatCards, createSession])

  // Listen for open-session-modal event (fired by ChatWindow when creating new session inside modal)
  useEffect(() => {
    const handleOpenSessionModal = (e: CustomEvent<{ sessionId: string }>) => {
      // The modal manages session tabs internally, just set active session in store
      if (selectedWorktreeModal) {
        useChatStore
          .getState()
          .setActiveSession(
            selectedWorktreeModal.worktreeId,
            e.detail.sessionId
          )
      }
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
  }, [selectedWorktreeModal])

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
        <div className="sticky top-0 z-10 flex items-center justify-between gap-4 bg-background/60 backdrop-blur-md px-4 py-3 border-b border-border/30 min-h-[61px]">
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
          {(worktreeSections.length > 0 || searchQuery) && (
            <>
              <div className="flex-1 flex justify-center max-w-md mx-auto">
                <div className="relative w-full">
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

              <div className="flex items-center gap-2 shrink-0">
                <OpenInButton worktreePath={project.path} />
                <ToggleGroup
                  type="single"
                  size="sm"
                  variant="outline"
                  value={canvasLayout}
                  onValueChange={value => {
                    if (value && preferences) {
                      savePreferences.mutate({
                        ...preferences,
                        canvas_layout: value as 'grid' | 'list',
                      })
                    }
                  }}
                >
                  <ToggleGroupItem value="grid" aria-label="Grid view">
                    <LayoutGrid className="h-3.5 w-3.5" />
                  </ToggleGroupItem>
                  <ToggleGroupItem value="list" aria-label="List view">
                    <List className="h-3.5 w-3.5" />
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
            </>
          )}
        </div>

        {/* Canvas View */}
        <div
          className={`flex-1 pb-16 ${worktreeSections.length === 0 && !searchQuery ? '' : isListLayout ? 'pt-5 px-4' : 'pt-6 px-4'}`}
        >
          {worktreeSections.length === 0 ? (
            searchQuery ? (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                No worktrees or sessions match your search
              </div>
            ) : (
              <EmptyDashboardTabs
                projectId={projectId}
                projectPath={project?.path ?? null}
              />
            )
          ) : isListLayout ? (
            /* List view: one compact row per worktree */
            <div className="flex flex-col">
              {worktreeSections.map(section => {
                const currentIndex = cardIndex++
                return section.isPending ? (
                  <WorktreeSetupCard
                    key={section.worktree.id}
                    ref={el => {
                      cardRefs.current[currentIndex] = el
                    }}
                    worktree={section.worktree}
                    layout="list"
                    isSelected={selectedIndex === currentIndex}
                    onSelect={() => setSelectedIndex(currentIndex)}
                  />
                ) : (
                  <div
                    key={section.worktree.id}
                    ref={el => {
                      cardRefs.current[currentIndex] = el
                    }}
                  >
                    <WorktreeSectionHeader
                      worktree={section.worktree}
                      projectId={projectId}
                      defaultBranch={project.default_branch}
                      sessionSummary={getSessionSummary(section.cards)}
                      activeStatus={getActiveStatus(section.cards)}
                      isSelected={selectedIndex === currentIndex}
                      onRowClick={() => {
                        setSelectedIndex(currentIndex)
                        handleWorktreeClick(
                          section.worktree.id,
                          section.worktree.path
                        )
                      }}
                    />
                  </div>
                )
              })}
            </div>
          ) : (
            /* Grid view: full card rendering */
            <div className="space-y-6">
              {worktreeSections.map(section => (
                <div key={section.worktree.id}>
                  <WorktreeSectionHeader
                    worktree={section.worktree}
                    projectId={projectId}
                    defaultBranch={project.default_branch}
                    activeStatus={getActiveStatus(section.cards)}
                  />

                  {section.isPending ? (
                    <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3">
                      {(() => {
                        const currentIndex = cardIndex++
                        return (
                          <WorktreeSetupCard
                            key={section.worktree.id}
                            ref={el => {
                              cardRefs.current[currentIndex] = el
                            }}
                            worktree={section.worktree}
                            layout={canvasLayout}
                            isSelected={selectedIndex === currentIndex}
                            onSelect={() => setSelectedIndex(currentIndex)}
                          />
                        )
                      })()}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-4">
                      {groupCardsByStatus(section.cards).map(group => (
                        <div key={group.key}>
                          <div className="mb-2 flex items-baseline gap-1.5">
                            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              {group.title}
                            </span>
                            <span className="text-[10px] text-muted-foreground/60">
                              {group.cards.length}
                            </span>
                          </div>
                          <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3">
                            {group.cards.map(card => {
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
                                    handleWorktreeClick(
                                      section.worktree.id,
                                      section.worktree.path
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
                                  onToggleLabel={() =>
                                    handleOpenLabelModal(card)
                                  }
                                  onToggleReview={() => {
                                    const {
                                      reviewingSessions,
                                      setSessionReviewing,
                                    } = useChatStore.getState()
                                    const isReviewing =
                                      reviewingSessions[card.session.id] ||
                                      !!card.session.review_results
                                    setSessionReviewing(
                                      card.session.id,
                                      !isReviewing
                                    )
                                  }}
                                />
                              )
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
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

      {/* Label Modal */}
      <LabelModal
        key={labelModalSessionId}
        isOpen={isLabelModalOpen}
        onClose={closeLabelModal}
        sessionId={labelModalSessionId}
        currentLabel={labelModalCurrentLabel}
      />

      {/* Session Chat Modal */}
      <SessionChatModal
        worktreeId={selectedWorktreeModal?.worktreeId ?? ''}
        worktreePath={selectedWorktreeModal?.worktreePath ?? ''}
        isOpen={!!selectedWorktreeModal}
        onClose={() => setSelectedWorktreeModal(null)}
      />

      {/* Keybinding hints */}
      {preferences?.show_keybinding_hints !== false && (
        <KeybindingHints
          hints={[
            { shortcut: 'Enter', label: 'open' },
            { shortcut: 'P', label: 'plan' },
            { shortcut: 'R', label: 'recap' },
            {
              shortcut: DEFAULT_KEYBINDINGS.open_in_modal as string,
              label: 'open in...',
            },
            {
              shortcut: DEFAULT_KEYBINDINGS.new_worktree as string,
              label: 'new worktree',
            },
            {
              shortcut: DEFAULT_KEYBINDINGS.new_session as string,
              label: 'new session',
            },
            {
              shortcut: DEFAULT_KEYBINDINGS.toggle_session_label as string,
              label: 'label',
            },
            {
              shortcut: DEFAULT_KEYBINDINGS.open_magic_modal as string,
              label: 'magic',
            },
            {
              shortcut: DEFAULT_KEYBINDINGS.close_session_or_worktree as string,
              label: 'close',
            },
          ]}
        />
      )}

      <CloseWorktreeDialog
        open={!!closeWorktreeTarget}
        onOpenChange={open => {
          if (!open) setCloseWorktreeTarget(null)
        }}
        onConfirm={handleConfirmCloseWorktree}
        branchName={closeWorktreeTarget?.branchName}
      />
    </div>
  )
}

function EmptyDashboardTabs({
  projectId,
  projectPath,
}: {
  projectId: string
  projectPath: string | null
}) {
  const shortcut = formatShortcutDisplay(DEFAULT_KEYBINDINGS.new_worktree)
  const { data: jeanConfig } = useJeanConfig(projectPath)
  const { openProjectSettings } = useProjectsStore.getState()

  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <p className="text-sm text-muted-foreground">
          Your imagination is the only limit
        </p>
        <Button
          variant="outline"
          size="lg"
          className="gap-2"
          onClick={() =>
            window.dispatchEvent(new CustomEvent('create-new-worktree'))
          }
        >
          <Plus className="h-4 w-4" />
          Start Building
          <kbd className="pointer-events-none ml-1 inline-flex h-5 items-center rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
            {shortcut}
          </kbd>
        </Button>
        {!jeanConfig && (
          <button
            type="button"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            onClick={() => openProjectSettings(projectId, 'jean-json')}
          >
            <FileJson className="h-3 w-3" />
            Add a jean.json to automate setup &amp; dev server
          </button>
        )}
      </div>
    </div>
  )
}
