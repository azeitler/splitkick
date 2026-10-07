import type { QueryClient } from '@tanstack/react-query'
import { invoke, listen } from '@/lib/transport'
import { chatQueryKeys, recordPlanHandoff } from '@/services/chat'
import { projectsQueryKeys } from '@/services/projects'
import type { PlanHandoff, Session, WorktreeSessions } from '@/types/chat'
import type {
  Worktree,
  WorktreeBranchExistsEvent,
  WorktreeCreateErrorEvent,
  WorktreeCreatedEvent,
  WorktreePathExistsEvent,
} from '@/types/projects'
import type { AppPreferences } from '@/types/preferences'

export interface FinishPlanHandoffParams {
  queryClient: QueryClient
  prefs: AppPreferences | undefined
  /** Source session (the one that wrote the plan) */
  worktreeId: string
  worktreePath: string
  sessionId: string
  /** Plan message id; falls back to the session's pending plan message */
  messageId: string | null | undefined
  /** Session that now runs the plan */
  newSession: Pick<Session, 'id' | 'name'>
  /** New worktree, when the plan went to a new worktree */
  newWorktree?: { id: string; name?: string | null }
  mode: 'build' | 'yolo'
}

/**
 * Last step of approving a plan into a new session or worktree.
 *
 * With `close_original_on_clear_context` on, the source session is closed or
 * archived (per `removal_behavior`). Otherwise the handoff is recorded so the
 * source chat shows a notice under the plan.
 */
export function finishPlanHandoff({
  queryClient,
  prefs,
  worktreeId,
  worktreePath,
  sessionId,
  messageId,
  newSession,
  newWorktree,
  mode,
}: FinishPlanHandoffParams): void {
  if (prefs?.close_original_on_clear_context) {
    closeOriginalSession(
      queryClient,
      prefs,
      worktreeId,
      worktreePath,
      sessionId,
      newWorktree ? null : newSession.id
    )
    return
  }

  const planMessageId =
    messageId ??
    queryClient.getQueryData<Session>(chatQueryKeys.session(sessionId))
      ?.pending_plan_message_id
  if (!planMessageId) return

  const handoff: PlanHandoff = {
    message_id: planMessageId,
    target_session_id: newSession.id,
    target_session_name: newSession.name,
    target_worktree_id: newWorktree?.id ?? worktreeId,
    target_worktree_name: newWorktree?.name ?? null,
    kind: newWorktree ? 'worktree' : 'session',
    mode,
    created_at: Math.floor(Date.now() / 1000),
    dismissed: false,
  }

  queryClient.setQueryData<Session>(chatQueryKeys.session(sessionId), old => {
    if (!old) return old
    return {
      ...old,
      plan_handoffs: [
        ...(old.plan_handoffs ?? []).filter(
          h => h.message_id !== planMessageId
        ),
        handoff,
      ],
    }
  })

  recordPlanHandoff(worktreeId, worktreePath, sessionId, handoff).catch(err =>
    console.error('[planHandoff] Failed to record plan handoff:', err)
  )
}

/**
 * Close or archive the source session right away.
 * cancel_process_if_running (used by close/archive) safely skips idle
 * sessions, and with_sessions_mut uses a per-worktree mutex, so this does not
 * race with send_chat_message on the new session.
 */
function closeOriginalSession(
  queryClient: QueryClient,
  prefs: AppPreferences | undefined,
  worktreeId: string,
  worktreePath: string,
  sessionId: string,
  /** New active session when it lives in the same worktree */
  sameWorktreeSessionId: string | null
): void {
  const command =
    prefs?.removal_behavior === 'archive' ? 'archive_session' : 'close_session'

  // Optimistically remove from UI so the user sees it gone at once
  queryClient.setQueryData<WorktreeSessions>(
    chatQueryKeys.sessions(worktreeId),
    old => {
      if (!old) return old
      return {
        ...old,
        sessions: old.sessions.filter(s => s.id !== sessionId),
        active_session_id:
          sameWorktreeSessionId && old.active_session_id === sessionId
            ? sameWorktreeSessionId
            : old.active_session_id,
      }
    }
  )

  invoke(command, { worktreeId, worktreePath, sessionId })
    .then(() =>
      queryClient.invalidateQueries({
        queryKey: chatQueryKeys.sessions(worktreeId),
      })
    )
    .catch(err =>
      console.error('[planHandoff] Failed to close original session:', err)
    )
}

const WORKTREE_READY_TIMEOUT_MS = 120_000

/**
 * Create a worktree for a plan handoff and wait until the backend has set it up.
 *
 * `create_worktree` returns a pending worktree at once and does the git work in
 * a background thread. The listeners are attached before the command runs:
 * attaching them after it returned missed a fast `worktree:created` event, and
 * the handoff then sat silent until the timeout.
 */
export async function createWorktreeAndWait(
  projectId: string,
  baseBranch?: string | null
): Promise<Worktree> {
  let pendingId: string | null = null
  const early = new Map<string, () => void>()
  let settle: { resolve: (w: Worktree) => void; reject: (e: Error) => void }
  const ready = new Promise<Worktree>((resolve, reject) => {
    settle = { resolve, reject }
  })

  // Events that arrive before create_worktree returned are replayed once the id is known
  const handle = (id: string, action: () => void) => {
    if (pendingId === null) early.set(id, action)
    else if (id === pendingId) action()
  }

  const unlisteners = await Promise.all([
    listen<WorktreeCreatedEvent>('worktree:created', event =>
      handle(event.payload.worktree.id, () =>
        settle.resolve(event.payload.worktree)
      )
    ),
    listen<WorktreeCreateErrorEvent>('worktree:error', event =>
      handle(event.payload.id, () =>
        settle.reject(new Error(event.payload.error))
      )
    ),
    listen<WorktreePathExistsEvent>('worktree:path_exists', event =>
      handle(event.payload.id, () =>
        settle.reject(
          new Error(`A worktree already exists at ${event.payload.path}`)
        )
      )
    ),
    listen<WorktreeBranchExistsEvent>('worktree:branch_exists', event =>
      handle(event.payload.id, () =>
        settle.reject(
          new Error(`Branch ${event.payload.branch} already exists`)
        )
      )
    ),
  ])
  const timeout = setTimeout(
    () => settle.reject(new Error('Worktree creation timed out')),
    WORKTREE_READY_TIMEOUT_MS
  )

  try {
    const pending = await invoke<Worktree>('create_worktree', {
      projectId,
      baseBranch: baseBranch || undefined,
    })
    pendingId = pending.id
    early.get(pending.id)?.()
    return await ready
  } finally {
    clearTimeout(timeout)
    for (const unlisten of unlisteners) unlisten()
  }
}

/** Branch of the worktree a plan was written in, used as the new worktree's base */
export function getSourceBranch(
  queryClient: QueryClient,
  projectId: string,
  worktreeId: string
): string | null {
  const worktrees = queryClient.getQueryData<Worktree[]>(
    projectsQueryKeys.worktrees(projectId)
  )
  return worktrees?.find(w => w.id === worktreeId)?.branch ?? null
}
