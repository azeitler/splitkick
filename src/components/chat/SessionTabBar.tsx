import {
  useCallback,
  useState,
  useRef,
  useEffect,
  startTransition,
  useMemo,
} from 'react'
import { Plus, X } from 'lucide-react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Eye,
  FileText,
  LayoutGrid,
  MessageSquare,
  Sparkles,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  useSessions,
  useCreateSession,
  useArchiveSession,
  useRenameSession,
  useReorderSessions,
} from '@/services/chat'
import { useCloseBaseSessionClean } from '@/services/projects'
import { usePreferences } from '@/services/preferences'
import { invoke } from '@/lib/transport'
import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'
import { useProjectsStore } from '@/store/projects-store'
import {
  isAskUserQuestion,
  isExitPlanMode,
  type Session,
  type ExecutionMode,
} from '@/types/chat'

interface SessionTabBarProps {
  worktreeId: string
  worktreePath: string
  /** Project ID for the worktree (used for closing base sessions) */
  projectId?: string
  /** Whether this is a base session (vs a worktree session) */
  isBase?: boolean
}

interface SortableTabProps {
  session: Session
  isActive: boolean
  isEditing: boolean
  isSessionSending: boolean
  isSessionWaiting: boolean
  isSessionReviewing: boolean
  sessionExecutionMode: ExecutionMode
  sessionsCount: number
  /** Whether closing the last session is allowed (true for base sessions) */
  canCloseLastSession: boolean
  editValue: string
  editInputRef: React.RefObject<HTMLInputElement | null>
  onTabClick: (sessionId: string) => void
  onDoubleClick: (sessionId: string, currentName: string) => void
  onCloseSession: (e: React.MouseEvent, sessionId: string) => void
  onEditValueChange: (value: string) => void
  onRenameSubmit: (sessionId: string) => void
  onRenameKeyDown: (e: React.KeyboardEvent, sessionId: string) => void
}

function SortableTab({
  session,
  isActive,
  isEditing,
  isSessionSending,
  isSessionWaiting,
  isSessionReviewing,
  sessionExecutionMode,
  sessionsCount,
  canCloseLastSession,
  editValue,
  editInputRef,
  onTabClick,
  onDoubleClick,
  onCloseSession,
  onEditValueChange,
  onRenameSubmit,
  onRenameKeyDown,
}: SortableTabProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: session.id,
    disabled: isEditing,
  })

  const style: React.CSSProperties = {
    // Use Translate instead of Transform to avoid scale which affects text rendering
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 1 : 0,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-session-id={session.id}
      {...attributes}
      {...listeners}
      onClick={() => onTabClick(session.id)}
      onDoubleClick={() => onDoubleClick(session.id, session.name)}
      className={cn(
        'group relative flex h-7 shrink-0 items-center gap-1 rounded-t px-2 text-sm transition-colors',
        isActive
          ? 'text-foreground font-medium border-b-2 border-foreground'
          : 'text-muted-foreground hover:text-foreground/70',
        isDragging ? 'cursor-grabbing' : 'cursor-grab',
        isSessionSending || isEditing ? 'cursor-pointer' : ''
      )}
    >
      {/* Session name (editable) */}
      {isEditing ? (
        <input
          ref={editInputRef}
          type="text"
          value={editValue}
          onChange={e => onEditValueChange(e.target.value)}
          onBlur={() => onRenameSubmit(session.id)}
          onKeyDown={e => onRenameKeyDown(e, session.id)}
          onClick={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
          className="w-full min-w-0 bg-transparent text-sm outline-none"
        />
      ) : (
        <>
          <span className="whitespace-nowrap">{session.name}</span>
          {/* Status badges - same style as WorktreeItem */}
          {isSessionSending &&
            !isSessionWaiting &&
            sessionExecutionMode === 'yolo' && (
              <span className="shrink-0 rounded-full bg-red-500/20 px-1.5 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
                yoloing
              </span>
            )}
          {isSessionSending &&
            !isSessionWaiting &&
            sessionExecutionMode !== 'yolo' && (
              <span className="shrink-0 rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                {sessionExecutionMode === 'plan' ? 'planning' : 'vibing'}
              </span>
            )}
          {isSessionWaiting && (
            <span className="shrink-0 rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              waiting
            </span>
          )}
          {/* Review badge - only when not actively sending/waiting */}
          {!isSessionSending && !isSessionWaiting && isSessionReviewing && (
            <span className="shrink-0 rounded-full bg-yellow-500/20 px-1.5 py-0.5 text-[10px] font-medium text-yellow-600 dark:text-yellow-400">
              review
            </span>
          )}
        </>
      )}

      {/* Close button (hidden while sending) */}
      {/* Show close button if: multiple sessions OR (last session AND canCloseLastSession) */}
      {(sessionsCount > 1 || canCloseLastSession) &&
        !isSessionSending &&
        !isEditing && (
          <button
            type="button"
            onClick={e => onCloseSession(e, session.id)}
            onPointerDown={e => e.stopPropagation()}
            className={cn(
              'ml-auto shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100',
              isActive && 'opacity-50'
            )}
            aria-label={`Close ${session.name}`}
          >
            <X className="h-3 w-3" />
          </button>
        )}
    </div>
  )
}

// Simplified session item for dropdown display (no drag-and-drop)
interface DropdownSessionItemProps {
  session: Session
  isActive: boolean
  isSessionSending: boolean
  isSessionWaiting: boolean
  isSessionReviewing: boolean
  sessionExecutionMode: ExecutionMode
  sessionsCount: number
  /** Whether closing the last session is allowed (true for base sessions) */
  canCloseLastSession: boolean
  onTabClick: (sessionId: string) => void
  onCloseSession: (e: React.MouseEvent, sessionId: string) => void
}

function DropdownSessionItem({
  session,
  isActive,
  isSessionSending,
  isSessionWaiting,
  isSessionReviewing,
  sessionExecutionMode,
  sessionsCount,
  canCloseLastSession,
  onTabClick,
  onCloseSession,
}: DropdownSessionItemProps) {
  return (
    <div
      onClick={() => onTabClick(session.id)}
      className={cn(
        'group relative flex cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-sm transition-colors duration-150',
        isActive
          ? 'bg-primary/10 text-foreground before:absolute before:left-0 before:top-0 before:h-full before:w-[3px] before:rounded-l before:bg-primary'
          : 'hover:bg-muted'
      )}
    >
      <span className="flex-1 truncate">{session.name}</span>

      {/* Status badges - same as SortableTab */}
      {isSessionSending &&
        !isSessionWaiting &&
        sessionExecutionMode === 'yolo' && (
          <span className="shrink-0 rounded-full bg-red-500/20 px-1.5 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
            yoloing
          </span>
        )}
      {isSessionSending &&
        !isSessionWaiting &&
        sessionExecutionMode !== 'yolo' && (
          <span className="shrink-0 rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            {sessionExecutionMode === 'plan' ? 'planning' : 'vibing'}
          </span>
        )}
      {isSessionWaiting && (
        <span className="shrink-0 rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
          waiting
        </span>
      )}
      {!isSessionSending && !isSessionWaiting && isSessionReviewing && (
        <span className="shrink-0 rounded-full bg-yellow-500/20 px-1.5 py-0.5 text-[10px] font-medium text-yellow-600 dark:text-yellow-400">
          review
        </span>
      )}

      {/* Close button */}
      {/* Show close button if: multiple sessions OR (last session AND canCloseLastSession) */}
      {(sessionsCount > 1 || canCloseLastSession) && !isSessionSending && (
        <button
          type="button"
          onClick={e => onCloseSession(e, session.id)}
          className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-muted-foreground/20 group-hover:opacity-100"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

// Session state interface for dropdown props
interface SessionState {
  id: string
  session: Session
  isSending: boolean
  isWaiting: boolean
  executionMode: ExecutionMode
}

// Collapsible dropdown for grouped sessions
type GroupType =
  | 'active'
  | 'planning'
  | 'vibing'
  | 'yoloing'
  | 'waiting'
  | 'review'

interface SessionGroupDropdownProps {
  label: string
  sessions: SessionState[]
  activeSessionId: string | undefined
  isViewingReviewTab: boolean
  reviewingSessions: Record<string, boolean>
  /** Whether closing the last session is allowed (true for base sessions) */
  canCloseLastSession: boolean
  onTabClick: (sessionId: string) => void
  onCloseSession: (e: React.MouseEvent, sessionId: string) => void
  groupType?: GroupType
}

// Styling config for each group type
const groupStyles: Record<
  GroupType,
  {
    icon: React.ReactNode
    activeClass: string
    badgeClass: string
  }
> = {
  active: {
    icon: <MessageSquare className="h-3.5 w-3.5" />,
    activeClass: 'font-medium text-foreground',
    badgeClass: 'bg-primary/10 text-primary',
  },
  planning: {
    icon: <FileText className="h-3.5 w-3.5" />,
    activeClass: 'bg-primary/20 font-medium text-primary',
    badgeClass: 'bg-primary/10 text-primary',
  },
  vibing: {
    icon: <Sparkles className="h-3.5 w-3.5" />,
    activeClass: 'bg-primary/20 font-medium text-primary',
    badgeClass: 'bg-primary/10 text-primary',
  },
  yoloing: {
    icon: <Zap className="h-3.5 w-3.5" />,
    activeClass: 'bg-red-500/20 font-medium text-red-600 dark:text-red-400',
    badgeClass: 'bg-red-500/10 text-red-600 dark:text-red-400',
  },
  waiting: {
    icon: <Clock className="h-3.5 w-3.5" />,
    activeClass: 'bg-primary/20 font-medium text-primary',
    badgeClass: 'bg-primary/10 text-primary',
  },
  review: {
    icon: <Eye className="h-3.5 w-3.5" />,
    activeClass:
      'bg-yellow-500/20 font-medium text-yellow-600 dark:text-yellow-400',
    badgeClass: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
  },
}

function SessionGroupDropdown({
  label,
  sessions,
  activeSessionId,
  isViewingReviewTab,
  reviewingSessions,
  canCloseLastSession,
  onTabClick,
  onCloseSession,
  groupType = 'active',
}: SessionGroupDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const styles = groupStyles[groupType]
  const isEmpty = sessions.length === 0

  // Check if active session is in this group
  const containsActiveSession = sessions.some(
    s => s.id === activeSessionId && !isViewingReviewTab
  )

  // Hover-to-open with delay (disabled when empty)
  const handleMouseEnter = useCallback(() => {
    if (isEmpty) return
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => setIsOpen(true), 150)
  }, [isEmpty])

  const handleMouseLeave = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => setIsOpen(false), 200)
  }, [])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])

  const handleTabClickWithClose = useCallback(
    (sessionId: string) => {
      onTabClick(sessionId)
      setIsOpen(false)
    },
    [onTabClick]
  )

  return (
    <Popover open={isOpen && !isEmpty} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'group relative flex h-7 shrink-0 items-center gap-1.5 rounded px-2 text-sm transition-colors duration-150',
            isEmpty
              ? 'cursor-default text-muted-foreground/50'
              : containsActiveSession
                ? styles.activeClass
                : 'text-muted-foreground hover:text-foreground/70'
          )}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onClick={() => {
            if (isEmpty) return
            const firstSession = sessions[0]
            if (sessions.length === 1 && firstSession) {
              onTabClick(firstSession.id)
            } else {
              setIsOpen(true)
            }
          }}
        >
          {styles.icon}
          <span>{label}</span>
          <span
            className={cn(
              'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
              isEmpty
                ? 'bg-muted/50 text-muted-foreground/50'
                : styles.badgeClass
            )}
          >
            {sessions.length}
          </span>
          {sessions.length > 1 && (
            <ChevronDown
              className={cn(
                'h-3 w-3 transition-transform',
                isOpen && 'rotate-180'
              )}
            />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="max-h-[300px] w-auto min-w-[200px] max-w-[280px] overflow-y-auto p-1.5"
        align="start"
        sideOffset={4}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onOpenAutoFocus={e => e.preventDefault()}
        onCloseAutoFocus={e => e.preventDefault()}
      >
        <div className="flex flex-col gap-0.5">
          {sessions.map(state => {
            const isActive = state.id === activeSessionId && !isViewingReviewTab
            const isSessionReviewing = reviewingSessions[state.id] ?? false

            return (
              <DropdownSessionItem
                key={state.id}
                session={state.session}
                isActive={isActive}
                isSessionSending={state.isSending}
                isSessionWaiting={state.isWaiting}
                isSessionReviewing={isSessionReviewing}
                sessionExecutionMode={state.executionMode}
                sessionsCount={sessions.length}
                canCloseLastSession={canCloseLastSession}
                onTabClick={handleTabClickWithClose}
                onCloseSession={onCloseSession}
              />
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function SessionTabBar({
  worktreeId,
  worktreePath,
  projectId,
  isBase = false,
}: SessionTabBarProps) {
  const { data: sessionsData, isLoading } = useSessions(
    worktreeId,
    worktreePath
  )
  const createSession = useCreateSession()
  const archiveSession = useArchiveSession()
  const closeBaseSessionClean = useCloseBaseSessionClean()
  const renameSession = useRenameSession()
  const reorderSessions = useReorderSessions()
  const { data: preferences } = usePreferences()

  // Drag-and-drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px movement before starting drag
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // PERFORMANCE: Use focused selectors and getState() for actions to prevent re-renders
  // Destructuring useChatStore() subscribes to entire store → re-renders on ANY change
  const activeSessionId = useChatStore(
    state => state.activeSessionIds[worktreeId]
  )
  const isViewingReviewTab = useChatStore(
    state => state.viewingReviewTab[worktreeId] ?? false
  )
  const isViewingCanvasTabRaw = useChatStore(
    state => state.viewingCanvasTab[worktreeId] ?? true // Default to canvas view
  )
  // Apply canvas preferences: if canvas disabled, never show; if canvas-only, always show
  const canvasEnabled = preferences?.canvas_enabled ?? true
  const canvasOnlyMode = preferences?.canvas_only_mode ?? false
  const isViewingCanvasTab = canvasEnabled
    ? canvasOnlyMode || isViewingCanvasTabRaw
    : false
  const reviewResults = useChatStore(state => state.reviewResults[worktreeId])
  const reviewingSessions = useChatStore(state => state.reviewingSessions)
  const uiStateInitialized = useUIStore(state => state.uiStateInitialized)

  // Actions via getState() - no subscription, stable references
  const {
    setActiveSession,
    setViewingReviewTab,
    setViewingCanvasTab,
    clearReviewResults,
    getActiveSession,
    isSending,
  } = useChatStore.getState()

  // Editing state for renaming
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)
  const tabScrollRef = useRef<HTMLDivElement>(null)
  const pendingScrollSessionRef = useRef<string | null>(null)

  // Focus input when editing starts
  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingId])

  // Set initial active session when sessions load
  useEffect(() => {
    // Wait for UI state to be restored from persisted storage first,
    // otherwise we'd overwrite the restored activeSessionIds with the first session
    if (!uiStateInitialized) return
    const sessions = sessionsData?.sessions
    const firstSession = sessions?.[0]
    if (sessions && sessions.length > 0 && firstSession) {
      const currentActive = getActiveSession(worktreeId)
      // If no active session set, or active session doesn't exist in list, set to first/active from data
      const sessionExists = sessions.some(s => s.id === currentActive)
      if (!currentActive || !sessionExists) {
        const targetSession = sessionsData.active_session_id ?? firstSession.id
        setActiveSession(worktreeId, targetSession)
      }
    }
  }, [sessionsData, worktreeId, getActiveSession, setActiveSession, uiStateInitialized])

  const handleCreateSession = useCallback(() => {
    createSession.mutate(
      { worktreeId, worktreePath },
      {
        onSuccess: session => {
          setActiveSession(worktreeId, session.id)
          // Mark session for scrolling after query refetch renders it
          pendingScrollSessionRef.current = session.id
        },
      }
    )
  }, [worktreeId, worktreePath, createSession, setActiveSession])

  // Scroll to pending session after query refetch renders it
  useEffect(() => {
    const pendingId = pendingScrollSessionRef.current
    if (!pendingId || !sessionsData?.sessions) return

    // Check if the pending session now exists in the list
    const sessionExists = sessionsData.sessions.some(s => s.id === pendingId)
    if (sessionExists) {
      pendingScrollSessionRef.current = null
      requestAnimationFrame(() => {
        const tab = tabScrollRef.current?.querySelector(
          `[data-session-id="${pendingId}"]`
        )
        tab?.scrollIntoView({
          behavior: 'smooth',
          inline: 'nearest',
          block: 'nearest',
        })
      })
    }
  }, [sessionsData?.sessions])

  // Listen for command:rename-session event from command palette
  useEffect(() => {
    const handleRenameSessionCommand = (
      e: CustomEvent<{ sessionId: string }>
    ) => {
      const { sessionId } = e.detail
      const session = sessionsData?.sessions.find(s => s.id === sessionId)
      if (session) {
        setEditingId(sessionId)
        setEditValue(session.name)
      }
    }

    window.addEventListener(
      'command:rename-session',
      handleRenameSessionCommand as EventListener
    )
    return () =>
      window.removeEventListener(
        'command:rename-session',
        handleRenameSessionCommand as EventListener
      )
  }, [sessionsData])

  const handleCloseSession = useCallback(
    (e: React.MouseEvent, sessionId: string) => {
      e.stopPropagation()

      // Don't close if this session is sending
      if (isSending(sessionId)) {
        return
      }

      // Check if this is the last session (for base session clean close)
      const nonArchivedSessions =
        sessionsData?.sessions.filter(s => !s.archived_at) ?? []
      const isLastSession = nonArchivedSessions.length === 1

      if (isLastSession && isBase && projectId) {
        // Last session in a base worktree: close the base session cleanly
        // This removes the session file entirely so it starts fresh on reopen
        const { selectProject } = useProjectsStore.getState()
        const { clearActiveWorktree } = useChatStore.getState()

        // Pre-select the project before closing
        selectProject(projectId)
        clearActiveWorktree()

        closeBaseSessionClean.mutate({ worktreeId, projectId })
      } else {
        // Normal case: archive the session
        archiveSession.mutate(
          { worktreeId, worktreePath, sessionId },
          {
            onSuccess: newActiveId => {
              if (newActiveId) {
                setActiveSession(worktreeId, newActiveId)
              }
            },
          }
        )
      }
    },
    [
      worktreeId,
      worktreePath,
      projectId,
      isBase,
      sessionsData,
      archiveSession,
      closeBaseSessionClean,
      setActiveSession,
      isSending,
    ]
  )

  // PERFORMANCE: Wrap state updates in startTransition to prevent UI blocking
  const handleTabClick = useCallback(
    (sessionId: string) => {
      startTransition(() => {
        setViewingReviewTab(worktreeId, false)
        setViewingCanvasTab(worktreeId, false)
        setActiveSession(worktreeId, sessionId)
      })
      // Fire-and-forget: persist active session to backend index
      invoke('set_active_session', { worktreeId, worktreePath, sessionId })
    },
    [worktreeId, worktreePath, setActiveSession, setViewingReviewTab, setViewingCanvasTab]
  )

  const handleReviewTabClick = useCallback(() => {
    setViewingReviewTab(worktreeId, true)
    setViewingCanvasTab(worktreeId, false)
  }, [worktreeId, setViewingReviewTab, setViewingCanvasTab])

  const handleCanvasTabClick = useCallback(() => {
    setViewingCanvasTab(worktreeId, true)
    setViewingReviewTab(worktreeId, false)
  }, [worktreeId, setViewingCanvasTab, setViewingReviewTab])

  const handleCloseReviewTab = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      clearReviewResults(worktreeId)
    },
    [worktreeId, clearReviewResults]
  )

  const handleDoubleClick = useCallback(
    (sessionId: string, currentName: string) => {
      setEditingId(sessionId)
      setEditValue(currentName)
    },
    []
  )

  const handleRenameSubmit = useCallback(
    (sessionId: string) => {
      const newName = editValue.trim()
      if (
        newName &&
        newName !== sessionsData?.sessions.find(s => s.id === sessionId)?.name
      ) {
        renameSession.mutate({
          worktreeId,
          worktreePath,
          sessionId,
          newName,
        })
      }
      setEditingId(null)
    },
    [editValue, worktreeId, worktreePath, renameSession, sessionsData]
  )

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent, sessionId: string) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleRenameSubmit(sessionId)
      } else if (e.key === 'Escape') {
        setEditingId(null)
      }
    },
    [handleRenameSubmit]
  )

  // Convert vertical scroll to horizontal scroll on tab bar
  const handleTabWheelScroll = useCallback((e: React.WheelEvent) => {
    if (e.deltaY !== 0 && tabScrollRef.current) {
      e.preventDefault()
      tabScrollRef.current.scrollLeft += e.deltaY
    }
  }, [])

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return

      const sessions = sessionsData?.sessions ?? []
      const oldIndex = sessions.findIndex(s => s.id === active.id)
      const newIndex = sessions.findIndex(s => s.id === over.id)

      if (oldIndex === -1 || newIndex === -1) return

      // Calculate new order
      const reorderedSessions = arrayMove(sessions, oldIndex, newIndex)
      const sessionIds = reorderedSessions.map(s => s.id)

      reorderSessions.mutate({
        worktreeId,
        worktreePath,
        sessionIds,
      })
    },
    [sessionsData?.sessions, worktreeId, worktreePath, reorderSessions]
  )

  // Subscribe to status-related state for immediate tab badge updates
  // These subscriptions ensure the tab bar re-renders when status changes
  const sendingSessionIds = useChatStore(state => state.sendingSessionIds)
  const executingModes = useChatStore(state => state.executingModes)
  const executionModes = useChatStore(state => state.executionModes)
  const activeToolCalls = useChatStore(state => state.activeToolCalls)
  const answeredQuestions = useChatStore(state => state.answeredQuestions)
  const waitingForInputSessionIds = useChatStore(
    state => state.waitingForInputSessionIds
  )

  // PERFORMANCE: Pre-compute session states ONCE per render instead of per-tab-map-iteration
  // This avoids O(n × m) work where n = sessions, m = messages per session
  // NOTE: This useMemo MUST be before any early returns (React hooks rules)
  const sessionStates = useMemo(() => {
    const sessions = sessionsData?.sessions ?? []
    return sessions.map(session => {
      const sessionSending = sendingSessionIds[session.id] ?? false
      const toolCalls = activeToolCalls[session.id] ?? []
      const answeredSet = answeredQuestions[session.id]

      // Check streaming tool calls for waiting state
      const isStreamingWaiting = toolCalls.some(
        tc =>
          (isAskUserQuestion(tc) || isExitPlanMode(tc)) &&
          !answeredSet?.has(tc.id)
      )

      // Check persisted messages for unanswered questions (when not streaming)
      // PERFORMANCE: Iterate backwards instead of .reverse() to avoid array copy
      let hasPendingQuestion = false
      if (!sessionSending) {
        const messages = session.messages
        for (let i = messages.length - 1; i >= 0; i--) {
          const msg = messages[i]
          if (msg?.role === 'assistant' && msg.tool_calls) {
            hasPendingQuestion = msg.tool_calls.some(
              tc =>
                (isAskUserQuestion(tc) || isExitPlanMode(tc)) &&
                !answeredSet?.has(tc.id)
            )
            break // Only check the last assistant message
          }
        }
      }

      // Check explicit waiting state (set by useStreamingEvents when AskUserQuestion/ExitPlanMode completes)
      const isExplicitlyWaiting = waitingForInputSessionIds[session.id] ?? false

      const sessionWaiting =
        isStreamingWaiting || hasPendingQuestion || isExplicitlyWaiting

      // Execution mode - use executingModes when sending for immediate feedback
      const executionMode = sessionSending
        ? (executingModes[session.id] ?? executionModes[session.id] ?? 'plan')
        : (executionModes[session.id] ?? 'plan')

      return {
        id: session.id,
        session,
        isSending: sessionSending,
        isWaiting: sessionWaiting,
        executionMode: executionMode as ExecutionMode,
      }
    })
  }, [
    sessionsData?.sessions,
    sendingSessionIds,
    executingModes,
    executionModes,
    activeToolCalls,
    answeredQuestions,
    waitingForInputSessionIds,
  ])

  // GROUPING: When > 3 sessions, group by status
  // The active session is extracted and shown as a standalone tab for better UX
  // Groups: Sessions (idle+yolo), Planning, Vibing, Waiting, Review
  // Sessions within each group are sorted by recent activity (last message timestamp)

  // Helper to get last activity timestamp for sorting
  const getLastActivityTime = useCallback((session: Session): number => {
    const messages = session.messages
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1]
      return lastMessage?.timestamp ?? session.created_at
    }
    return session.created_at
  }, [])

  // Sort helper - most recent first
  const sortByRecentActivity = useCallback(
    (a: SessionState, b: SessionState): number => {
      return getLastActivityTime(b.session) - getLastActivityTime(a.session)
    },
    [getLastActivityTime]
  )

  const {
    shouldGroup,
    activeGroupStates,
    planningGroupStates,
    vibingGroupStates,
    yoloingGroupStates,
    waitingGroupStates,
    reviewingGroupStates,
  } = useMemo(() => {
    const shouldGroup = preferences?.session_grouping_enabled ?? true

    if (!shouldGroup) {
      return {
        shouldGroup: false,
        activeGroupStates: [],
        planningGroupStates: [],
        vibingGroupStates: [],
        yoloingGroupStates: [],
        waitingGroupStates: [],
        reviewingGroupStates: [],
      }
    }

    const activeGroupStates: SessionState[] = []
    const planningGroupStates: SessionState[] = []
    const vibingGroupStates: SessionState[] = []
    const yoloingGroupStates: SessionState[] = []
    const waitingGroupStates: SessionState[] = []
    const reviewingGroupStates: SessionState[] = []

    for (const s of sessionStates) {
      if (s.isWaiting) {
        waitingGroupStates.push(s)
      } else if (reviewingSessions[s.id]) {
        reviewingGroupStates.push(s)
      } else if (s.isSending && s.executionMode === 'plan') {
        planningGroupStates.push(s)
      } else if (s.isSending && s.executionMode === 'build') {
        vibingGroupStates.push(s)
      } else if (s.isSending && s.executionMode === 'yolo') {
        yoloingGroupStates.push(s)
      } else {
        // Sessions group: idle sessions only
        activeGroupStates.push(s)
      }
    }

    // Sort each group by recent activity (most recent first)
    return {
      shouldGroup,
      activeGroupStates: activeGroupStates.sort(sortByRecentActivity),
      planningGroupStates: planningGroupStates.sort(sortByRecentActivity),
      vibingGroupStates: vibingGroupStates.sort(sortByRecentActivity),
      yoloingGroupStates: yoloingGroupStates.sort(sortByRecentActivity),
      waitingGroupStates: waitingGroupStates.sort(sortByRecentActivity),
      reviewingGroupStates: reviewingGroupStates.sort(sortByRecentActivity),
    }
  }, [
    sessionStates,
    reviewingSessions,
    sortByRecentActivity,
    preferences?.session_grouping_enabled,
  ])

  // Compute visual order for keyboard navigation (matches display order)
  const visualOrderSessions = useMemo(() => {
    if (!shouldGroup) {
      // Flat mode: sessionStates order matches visual
      return sessionStates.map(s => s.session)
    }
    // Grouped mode: concat groups in visual order (Idle → Planning → Waiting → Vibing → Yoloing → Review)
    return [
      ...activeGroupStates,
      ...planningGroupStates,
      ...waitingGroupStates,
      ...vibingGroupStates,
      ...yoloingGroupStates,
      ...reviewingGroupStates,
    ].map(s => s.session)
  }, [
    shouldGroup,
    sessionStates,
    activeGroupStates,
    planningGroupStates,
    waitingGroupStates,
    vibingGroupStates,
    yoloingGroupStates,
    reviewingGroupStates,
  ])

  // Listen for global switch-session event from keybindings (CMD+Arrow)
  // Use throttle to prevent flickery switching when pressing rapidly
  const lastSwitchTimeRef = useRef(0)
  const SWITCH_THROTTLE_MS = 100

  useEffect(() => {
    const handleSwitchSession = (
      e: CustomEvent<{ direction: 'next' | 'previous' }>
    ) => {
      // Throttle rapid switches
      const now = Date.now()
      if (now - lastSwitchTimeRef.current < SWITCH_THROTTLE_MS) return
      lastSwitchTimeRef.current = now

      if (!visualOrderSessions.length) return

      const sessions = visualOrderSessions
      const currentIndex = sessions.findIndex(s => s.id === activeSessionId)
      if (currentIndex === -1) return

      let newIndex: number
      if (e.detail.direction === 'next') {
        newIndex = (currentIndex + 1) % sessions.length
      } else {
        newIndex = (currentIndex - 1 + sessions.length) % sessions.length
      }

      const newSession = sessions[newIndex]
      if (newSession) {
        // PERFORMANCE: Wrap in startTransition to prevent UI blocking
        startTransition(() => {
          setActiveSession(worktreeId, newSession.id)
        })

        // Scroll the new tab into view
        requestAnimationFrame(() => {
          const tab = tabScrollRef.current?.querySelector(
            `[data-session-id="${newSession.id}"]`
          )
          tab?.scrollIntoView({
            behavior: 'smooth',
            inline: 'nearest',
            block: 'nearest',
          })
        })
      }
    }

    window.addEventListener(
      'switch-session',
      handleSwitchSession as EventListener
    )
    return () =>
      window.removeEventListener(
        'switch-session',
        handleSwitchSession as EventListener
      )
  }, [visualOrderSessions, activeSessionId, worktreeId, setActiveSession])

  if (isLoading) {
    return (
      <div className="flex h-8 items-center px-2">
        <span className="text-sm text-muted-foreground">Loading...</span>
      </div>
    )
  }

  return (
    <div
      className="flex h-8 items-center border-b border-border/50"
      onWheel={handleTabWheelScroll}
    >
      <ScrollArea
        className="h-full w-full [&_[data-slot=scroll-area-viewport]]:!overflow-y-hidden [&_[data-slot=scroll-area-viewport]]:!overflow-x-scroll [&_[data-slot=scroll-area-scrollbar]]:hidden"
        viewportRef={tabScrollRef}
      >
        <div className="flex h-8 items-center gap-0.5 px-2">
          {/* Canvas tab - session overview grid (shown when canvas is enabled) */}
          {canvasEnabled && (
            <button
              type="button"
              onClick={handleCanvasTabClick}
              className={cn(
                'group relative flex h-7 shrink-0 items-center gap-1 rounded-t px-2 text-sm transition-colors',
                isViewingCanvasTab
                  ? 'text-foreground font-medium border-b-2 border-foreground'
                  : 'text-muted-foreground hover:text-foreground/70'
              )}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              <span className="whitespace-nowrap">Canvas</span>
              <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                {sessionStates.length}
              </span>
            </button>
          )}

          {/* AI Review results tab - shown when review results exist */}
          {reviewResults && (
            <div
              onClick={handleReviewTabClick}
              className={cn(
                'group relative flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-t px-2 text-sm transition-colors',
                isViewingReviewTab
                  ? 'text-foreground font-medium border-b-2 border-foreground'
                  : 'text-muted-foreground hover:text-foreground/70'
              )}
            >
              {/* Status icon based on approval status */}
              {reviewResults.approval_status === 'approved' ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
              ) : reviewResults.approval_status === 'changes_requested' ? (
                <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />
              ) : (
                <MessageSquare className="h-3.5 w-3.5 text-blue-500" />
              )}
              <span className="whitespace-nowrap">Review</span>
              {reviewResults.findings.length > 0 && (
                <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium">
                  {reviewResults.findings.length}
                </span>
              )}

              {/* Close button */}
              <button
                type="button"
                onClick={handleCloseReviewTab}
                className={cn(
                  'ml-auto shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100',
                  isViewingReviewTab && 'opacity-50'
                )}
                aria-label="Close review results"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          {/* Session tabs - grouped or flat depending on count (hidden in canvas-only mode) */}
          {canvasOnlyMode ? null : shouldGroup ? (
            // GROUPED MODE (> 6 sessions) - no drag-and-drop
            <>
              <SessionGroupDropdown
                label="Idle"
                sessions={activeGroupStates}
                activeSessionId={activeSessionId}
                isViewingReviewTab={isViewingReviewTab}
                reviewingSessions={reviewingSessions}
                canCloseLastSession={isBase}
                onTabClick={handleTabClick}
                onCloseSession={handleCloseSession}
                groupType="active"
              />
              <SessionGroupDropdown
                label="Planning"
                sessions={planningGroupStates}
                activeSessionId={activeSessionId}
                isViewingReviewTab={isViewingReviewTab}
                reviewingSessions={reviewingSessions}
                canCloseLastSession={isBase}
                onTabClick={handleTabClick}
                onCloseSession={handleCloseSession}
                groupType="planning"
              />
              <SessionGroupDropdown
                label="Waiting"
                sessions={waitingGroupStates}
                activeSessionId={activeSessionId}
                isViewingReviewTab={isViewingReviewTab}
                reviewingSessions={reviewingSessions}
                canCloseLastSession={isBase}
                onTabClick={handleTabClick}
                onCloseSession={handleCloseSession}
                groupType="waiting"
              />
              <SessionGroupDropdown
                label="Vibing"
                sessions={vibingGroupStates}
                activeSessionId={activeSessionId}
                isViewingReviewTab={isViewingReviewTab}
                reviewingSessions={reviewingSessions}
                canCloseLastSession={isBase}
                onTabClick={handleTabClick}
                onCloseSession={handleCloseSession}
                groupType="vibing"
              />
              <SessionGroupDropdown
                label="Yoloing"
                sessions={yoloingGroupStates}
                activeSessionId={activeSessionId}
                isViewingReviewTab={isViewingReviewTab}
                reviewingSessions={reviewingSessions}
                canCloseLastSession={isBase}
                onTabClick={handleTabClick}
                onCloseSession={handleCloseSession}
                groupType="yoloing"
              />
              <SessionGroupDropdown
                label="Review"
                sessions={reviewingGroupStates}
                activeSessionId={activeSessionId}
                isViewingReviewTab={isViewingReviewTab}
                reviewingSessions={reviewingSessions}
                canCloseLastSession={isBase}
                onTabClick={handleTabClick}
                onCloseSession={handleCloseSession}
                groupType="review"
              />
            </>
          ) : (
            // FLAT MODE (6 or fewer sessions) - with drag-and-drop
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
              modifiers={[restrictToHorizontalAxis]}
            >
              <SortableContext
                items={sessionStates.map(s => s.id)}
                strategy={horizontalListSortingStrategy}
              >
                {/* PERFORMANCE: Use pre-computed sessionStates instead of inline computation */}
                {sessionStates.map(state => {
                  const isActive =
                    state.id === activeSessionId && !isViewingReviewTab
                  const isEditing = editingId === state.id
                  const isSessionReviewing =
                    reviewingSessions[state.id] ?? false

                  return (
                    <SortableTab
                      key={state.id}
                      session={state.session}
                      isActive={isActive}
                      isEditing={isEditing}
                      isSessionSending={state.isSending}
                      isSessionWaiting={state.isWaiting}
                      isSessionReviewing={isSessionReviewing}
                      sessionExecutionMode={state.executionMode}
                      sessionsCount={sessionStates.length}
                      canCloseLastSession={isBase}
                      editValue={editValue}
                      editInputRef={editInputRef}
                      onTabClick={handleTabClick}
                      onDoubleClick={handleDoubleClick}
                      onCloseSession={handleCloseSession}
                      onEditValueChange={setEditValue}
                      onRenameSubmit={handleRenameSubmit}
                      onRenameKeyDown={handleRenameKeyDown}
                    />
                  )
                })}
              </SortableContext>
            </DndContext>
          )}

          {/* Add new session button (hidden in canvas-only mode) */}
          {!canvasOnlyMode && (
            <button
              type="button"
              onClick={handleCreateSession}
              disabled={createSession.isPending}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
              aria-label="New session"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
