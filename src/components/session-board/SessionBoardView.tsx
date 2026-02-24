import { useMemo, useCallback, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useWorktrees, useProjects } from '@/services/projects'
import { useSessions } from '@/services/chat'
import { useChatStore } from '@/store/chat-store'
import { useShallow } from 'zustand/react/shallow'
import { useProjectsStore } from '@/store/projects-store'
import { isAskUserQuestion, isExitPlanMode, type ToolCall } from '@/types/chat'
import type { ExecutionMode } from '@/types/chat'
import type { Session } from '@/types/chat'
import type { Worktree } from '@/types/projects'
import { NewIssuesBadge } from '@/components/shared/NewIssuesBadge'
import { OpenPRsBadge } from '@/components/shared/OpenPRsBadge'
import { FailedRunsBadge } from '@/components/shared/FailedRunsBadge'
import { SessionCard } from './SessionCard'
import { SessionColumn } from './SessionColumn'
import { Spinner } from '@/components/ui/spinner'

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = () => {}

interface BoardSession {
  sessionId: string
  sessionName: string
  worktreeId: string
  worktreeName: string
  worktreePath: string
  column: 'idle' | 'active' | 'waiting' | 'reviewing'
  executionMode?: ExecutionMode
  isWaiting?: boolean
  isReviewing?: boolean
}

interface SessionBoardViewProps {
  projectId: string
  onSessionClick: (worktreeId: string, sessionId: string) => void
}

export function SessionBoardView({
  projectId,
  onSessionClick,
}: SessionBoardViewProps) {
  // Get all projects to find the current one
  const { data: projects = [], isLoading: projectsLoading } = useProjects()
  const project = projects.find(p => p.id === projectId)

  // Get all worktrees in the project
  const { data: worktrees = [], isLoading: worktreesLoading } =
    useWorktrees(projectId)

  // Get chat store state for determining session status
  const {
    sendingSessionIds,
    activeToolCalls,
    answeredQuestions,
    executionModes,
    executingModes,
    reviewingSessions,
    setSessionReviewing,
    setActiveWorktree,
    setActiveSession,
  } = useChatStore(
    useShallow(state => ({
      sendingSessionIds: state.sendingSessionIds,
      activeToolCalls: state.activeToolCalls,
      answeredQuestions: state.answeredQuestions,
      executionModes: state.executionModes,
      executingModes: state.executingModes,
      reviewingSessions: state.reviewingSessions,
      setSessionReviewing: state.setSessionReviewing,
      setActiveWorktree: state.setActiveWorktree,
      setActiveSession: state.setActiveSession,
    }))
  )

  // Also need to update projects store when switching worktrees
  const selectProject = useProjectsStore(state => state.selectProject)
  const selectWorktree = useProjectsStore(state => state.selectWorktree)

  // Track actively dragged session for DragOverlay
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

  // Setup sensors for drag-and-drop
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Handle click on a session card
  const handleSessionClick = useCallback(
    (sessionWorktreeId: string, sessionId: string, worktreePath: string) => {
      // Select the project and worktree, set as active
      selectProject(projectId)
      selectWorktree(sessionWorktreeId)
      setActiveWorktree(sessionWorktreeId, worktreePath)
      // Set the session as active
      setActiveSession(sessionWorktreeId, sessionId)
      // Call the parent callback
      onSessionClick(sessionWorktreeId, sessionId)
    },
    [
      projectId,
      selectProject,
      selectWorktree,
      setActiveWorktree,
      setActiveSession,
      onSessionClick,
    ]
  )

  // Handle drag start - track which session is being dragged
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveSessionId(event.active.id as string)
  }, [])

  // Handle drag end
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveSessionId(null)

      const { active, over } = event
      if (!over) return

      const sessionId = active.id as string
      const targetColumn = over.id as 'idle' | 'active' | 'reviewing'

      // Only allow moving between idle and reviewing
      if (targetColumn === 'active') return

      // Determine current column for the session
      const isCurrentlyReviewing = reviewingSessions[sessionId]

      // If dropping on reviewing and not already reviewing, mark as reviewing
      if (targetColumn === 'reviewing' && !isCurrentlyReviewing) {
        setSessionReviewing(sessionId, true)
      }
      // If dropping on idle and currently reviewing, unmark
      else if (targetColumn === 'idle' && isCurrentlyReviewing) {
        setSessionReviewing(sessionId, false)
      }
    },
    [reviewingSessions, setSessionReviewing]
  )

  // Compute session state and classify into column
  const computeSessionState = useCallback(
    (session: Session, worktree: Worktree): BoardSession => {
      const sessionId = session.id
      const isSending = sendingSessionIds[sessionId] ?? false

      // Check for waiting state (has pending AskUserQuestion or ExitPlanMode)
      const toolCalls = (activeToolCalls[sessionId] ?? []) as ToolCall[]
      const answeredSet = answeredQuestions[sessionId]

      // Check streaming tool calls for waiting
      const isStreamingWaiting = toolCalls.some(
        tc =>
          (isAskUserQuestion(tc) || isExitPlanMode(tc)) &&
          !answeredSet?.has(tc.id)
      )

      // Check persisted messages for waiting (when not streaming)
      let hasPendingQuestion = false
      if (!isSending) {
        const messages = session.messages
        for (let i = messages.length - 1; i >= 0; i--) {
          const msg = messages[i]
          if (msg?.role === 'assistant' && msg.tool_calls) {
            hasPendingQuestion = msg.tool_calls.some(
              tc =>
                (isAskUserQuestion(tc) || isExitPlanMode(tc)) &&
                !answeredSet?.has(tc.id)
            )
            break
          }
        }
      }

      const isWaiting = isStreamingWaiting || hasPendingQuestion
      const isReviewing = reviewingSessions[sessionId] ?? false

      // Determine execution mode
      const executionMode = isSending
        ? (executingModes[sessionId] ?? executionModes[sessionId] ?? 'plan')
        : (executionModes[sessionId] ?? 'plan')

      // Determine column
      let column: 'idle' | 'active' | 'waiting' | 'reviewing' = 'idle'
      if (isWaiting) {
        column = 'waiting'
      } else if (isSending) {
        column = 'active'
      } else if (isReviewing) {
        column = 'reviewing'
      }

      return {
        sessionId,
        sessionName: session.name,
        worktreeId: worktree.id,
        worktreeName: worktree.name,
        worktreePath: worktree.path,
        column,
        executionMode,
        isWaiting,
        isReviewing,
      }
    },
    [
      sendingSessionIds,
      activeToolCalls,
      answeredQuestions,
      executionModes,
      executingModes,
      reviewingSessions,
    ]
  )

  if (projectsLoading || worktreesLoading) {
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

  // Filter to ready worktrees only (undefined status treated as ready for older worktrees)
  const readyWorktrees = worktrees.filter(
    wt => !wt.status || wt.status === 'ready' || wt.status === 'error'
  )

  return (
    <div className="flex h-full flex-col p-4">
      {/* Header */}
      <div className="mb-4 flex items-center justify-end gap-2">
        <span className="text-sm text-muted-foreground">{project.name}</span>
        <NewIssuesBadge projectPath={project.path} projectId={project.id} />
        <OpenPRsBadge projectPath={project.path} projectId={project.id} />
        <FailedRunsBadge projectPath={project.path} />
      </div>

      {/* Session Board */}
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex flex-1 gap-4 overflow-x-auto">
          <MultiWorktreeSessionsView
            worktrees={readyWorktrees}
            computeSessionState={computeSessionState}
            onSessionClick={handleSessionClick}
            activeSessionId={activeSessionId}
          />
        </div>
      </DndContext>
    </div>
  )
}

// Component that renders sessions from multiple worktrees
interface MultiWorktreeSessionsViewProps {
  worktrees: Worktree[]
  computeSessionState: (session: Session, worktree: Worktree) => BoardSession
  onSessionClick: (
    worktreeId: string,
    sessionId: string,
    worktreePath: string
  ) => void
  activeSessionId: string | null
}

function MultiWorktreeSessionsView({
  worktrees,
  computeSessionState,
  onSessionClick,
  activeSessionId,
}: MultiWorktreeSessionsViewProps) {
  // Load sessions for first 10 worktrees (to avoid too many queries)
  // In production, you might want pagination or virtualization
  const limitedWorktrees = worktrees.slice(0, 10)

  // Load sessions using hooks at component level
  // Note: This is a simplified approach - hooks should be called unconditionally
  const wt0 = limitedWorktrees[0]
  const wt1 = limitedWorktrees[1]
  const wt2 = limitedWorktrees[2]
  const wt3 = limitedWorktrees[3]
  const wt4 = limitedWorktrees[4]
  const wt5 = limitedWorktrees[5]
  const wt6 = limitedWorktrees[6]
  const wt7 = limitedWorktrees[7]
  const wt8 = limitedWorktrees[8]
  const wt9 = limitedWorktrees[9]

  const q0 = useSessions(wt0?.id ?? null, wt0?.path ?? null)
  const q1 = useSessions(wt1?.id ?? null, wt1?.path ?? null)
  const q2 = useSessions(wt2?.id ?? null, wt2?.path ?? null)
  const q3 = useSessions(wt3?.id ?? null, wt3?.path ?? null)
  const q4 = useSessions(wt4?.id ?? null, wt4?.path ?? null)
  const q5 = useSessions(wt5?.id ?? null, wt5?.path ?? null)
  const q6 = useSessions(wt6?.id ?? null, wt6?.path ?? null)
  const q7 = useSessions(wt7?.id ?? null, wt7?.path ?? null)
  const q8 = useSessions(wt8?.id ?? null, wt8?.path ?? null)
  const q9 = useSessions(wt9?.id ?? null, wt9?.path ?? null)

  const queries = useMemo(
    () => [q0, q1, q2, q3, q4, q5, q6, q7, q8, q9],
    [q0, q1, q2, q3, q4, q5, q6, q7, q8, q9]
  )

  // Aggregate all sessions
  const allBoardSessions = useMemo(() => {
    const sessions: BoardSession[] = []

    for (let i = 0; i < limitedWorktrees.length; i++) {
      const worktree = limitedWorktrees[i]
      const query = queries[i]

      if (!worktree || !query?.data?.sessions) continue

      for (const session of query.data.sessions) {
        sessions.push(computeSessionState(session, worktree))
      }
    }

    return sessions
  }, [limitedWorktrees, queries, computeSessionState])

  // Group by column
  const groupedSessions = useMemo(() => {
    const idle: BoardSession[] = []
    const active: BoardSession[] = []
    const waiting: BoardSession[] = []
    const reviewing: BoardSession[] = []

    for (const session of allBoardSessions) {
      if (session.column === 'active') {
        active.push(session)
      } else if (session.column === 'waiting') {
        waiting.push(session)
      } else if (session.column === 'reviewing') {
        reviewing.push(session)
      } else {
        idle.push(session)
      }
    }

    return { idle, active, waiting, reviewing }
  }, [allBoardSessions])

  // Find the active session for DragOverlay
  const activeSession = useMemo(() => {
    if (!activeSessionId) return null
    return allBoardSessions.find(s => s.sessionId === activeSessionId) ?? null
  }, [activeSessionId, allBoardSessions])

  // Check if any queries are still loading
  const isLoading = queries.some(q => q.isLoading)

  if (isLoading && allBoardSessions.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    )
  }

  return (
    <>
      <SessionColumn
        id="idle"
        title="Idle"
        count={groupedSessions.idle.length}
        droppable={true}
        itemIds={groupedSessions.idle.map(s => s.sessionId)}
      >
        {groupedSessions.idle.map(session => (
          <SessionCard
            key={session.sessionId}
            sessionId={session.sessionId}
            sessionName={session.sessionName}
            worktreeName={session.worktreeName}
            column={session.column}
            executionMode={session.executionMode}
            isReviewing={session.isReviewing}
            onClick={() =>
              onSessionClick(
                session.worktreeId,
                session.sessionId,
                session.worktreePath
              )
            }
          />
        ))}
      </SessionColumn>

      <SessionColumn
        id="reviewing"
        title="Review"
        count={groupedSessions.reviewing.length}
        droppable={true}
        itemIds={groupedSessions.reviewing.map(s => s.sessionId)}
      >
        {groupedSessions.reviewing.map(session => (
          <SessionCard
            key={session.sessionId}
            sessionId={session.sessionId}
            sessionName={session.sessionName}
            worktreeName={session.worktreeName}
            column={session.column}
            executionMode={session.executionMode}
            isReviewing={session.isReviewing}
            onClick={() =>
              onSessionClick(
                session.worktreeId,
                session.sessionId,
                session.worktreePath
              )
            }
          />
        ))}
      </SessionColumn>

      <SessionColumn
        id="active"
        title="Active"
        count={groupedSessions.active.length}
        droppable={false}
        itemIds={groupedSessions.active.map(s => s.sessionId)}
      >
        {groupedSessions.active.map(session => (
          <SessionCard
            key={session.sessionId}
            sessionId={session.sessionId}
            sessionName={session.sessionName}
            worktreeName={session.worktreeName}
            column={session.column}
            executionMode={session.executionMode}
            isReviewing={session.isReviewing}
            disabled={true}
            onClick={() =>
              onSessionClick(
                session.worktreeId,
                session.sessionId,
                session.worktreePath
              )
            }
          />
        ))}
      </SessionColumn>

      <SessionColumn
        id="waiting"
        title="Waiting"
        count={groupedSessions.waiting.length}
        droppable={false}
        itemIds={groupedSessions.waiting.map(s => s.sessionId)}
      >
        {groupedSessions.waiting.map(session => (
          <SessionCard
            key={session.sessionId}
            sessionId={session.sessionId}
            sessionName={session.sessionName}
            worktreeName={session.worktreeName}
            column={session.column}
            executionMode={session.executionMode}
            isReviewing={session.isReviewing}
            disabled={true}
            onClick={() =>
              onSessionClick(
                session.worktreeId,
                session.sessionId,
                session.worktreePath
              )
            }
          />
        ))}
      </SessionColumn>

      {/* DragOverlay shows the card being dragged */}
      <DragOverlay>
        {activeSession && (
          <SessionCard
            sessionId={activeSession.sessionId}
            sessionName={activeSession.sessionName}
            worktreeName={activeSession.worktreeName}
            column={activeSession.column}
            executionMode={activeSession.executionMode}
            isReviewing={activeSession.isReviewing}
            onClick={noop}
            disabled
          />
        )}
      </DragOverlay>
    </>
  )
}
