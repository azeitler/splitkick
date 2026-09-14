import { useCallback } from 'react'
import { toast } from 'sonner'
import { invoke } from '@/lib/transport'
import { queryClient } from '@/lib/query-client'
import { chatQueryKeys } from '@/services/chat'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { projectsQueryKeys } from '@/services/projects'
import type { Session } from '@/types/chat'
import type { Worktree } from '@/types/projects'
import { navigateToForkedSession } from '../fork-session-navigation'

interface ForkSessionToWorktreeResponse {
  worktree: Worktree
  session: Session
}

/** The session a fork acts on. Passed per call, so one hook serves many worktrees. */
export interface SessionForkTarget {
  worktreeId: string
  sessionId: string
}

export interface SessionForkInPlaceTarget extends SessionForkTarget {
  /**
   * Fork from this message instead of the end of the session. An assistant message
   * id keeps that answer; a user message id stops just before that prompt.
   */
  fromMessageId?: string
}

interface ForkPresentation {
  /** Whether the caller currently renders inside SessionChatModal. */
  sessionChatModalOpen?: boolean
}

/**
 * The two session fork actions, in one place.
 *
 * Both callbacks are stable (empty dependency arrays, stores read through
 * `getState()`), so memoized callers such as `MessageItem` keep their memoization.
 *
 * Uses the `queryClient` singleton rather than `useQueryClient()`, matching
 * `session-pin-actions.ts`: it is the same client the app's provider holds, and it
 * keeps this hook usable from menu components that render outside a provider in tests.
 */
export function useSessionFork() {
  /**
   * Fork into a brand new git worktree, branched at the source worktree's HEAD,
   * then navigate there.
   */
  const forkToWorktree = useCallback(
    async (
      target: SessionForkTarget,
      presentation: ForkPresentation = {}
    ): Promise<void> => {
      const toastId = toast.loading('Forking session to a new worktree...')
      try {
        const result = await invoke<ForkSessionToWorktreeResponse>(
          'fork_session_to_worktree',
          {
            sourceWorktreeId: target.worktreeId,
            sourceSessionId: target.sessionId,
          }
        )

        const { worktree: forkedWorktree, session: forkedSession } = result
        queryClient.setQueryData<Worktree>(
          [...projectsQueryKeys.all, 'worktree', forkedWorktree.id],
          forkedWorktree
        )
        queryClient.setQueryData<Session>(
          chatQueryKeys.session(forkedSession.id),
          forkedSession
        )
        queryClient.invalidateQueries({ queryKey: projectsQueryKeys.list() })
        queryClient.invalidateQueries({
          queryKey: projectsQueryKeys.worktrees(forkedWorktree.project_id),
        })
        queryClient.invalidateQueries({
          queryKey: chatQueryKeys.sessions(forkedWorktree.id),
        })

        const projectsStore = useProjectsStore.getState()
        const chatStore = useChatStore.getState()
        navigateToForkedSession(
          forkedWorktree,
          forkedSession,
          {
            activeWorktreePath: chatStore.activeWorktreePath,
            sessionChatModalOpen: presentation.sessionChatModalOpen ?? false,
          },
          {
            expandProject: projectsStore.expandProject,
            selectWorktree: projectsStore.selectWorktree,
            registerWorktreePath: chatStore.registerWorktreePath,
            setActiveWorktree: chatStore.setActiveWorktree,
            setActiveSession: chatStore.setActiveSession,
            addUserInitiatedSession: chatStore.addUserInitiatedSession,
            openWorktreeModal: (worktreeId, worktreePath) => {
              window.dispatchEvent(
                new CustomEvent('open-worktree-modal', {
                  detail: { worktreeId, worktreePath },
                })
              )
            },
          }
        )

        toast.success(`Forked session to ${forkedWorktree.name}`, {
          id: toastId,
        })
      } catch (err) {
        toast.error(`Failed to fork session: ${err}`, { id: toastId })
      }
    },
    []
  )

  /**
   * Fork into a sibling session in the same worktree, on the same working
   * directory, then select it. No worktree navigation — we stay where we are.
   */
  const forkInPlace = useCallback(
    async (target: SessionForkInPlaceTarget): Promise<void> => {
      const toastId = toast.loading(
        target.fromMessageId
          ? 'Forking session from this message...'
          : 'Forking session...'
      )
      try {
        const forkedSession = await invoke<Session>('fork_session_in_place', {
          worktreeId: target.worktreeId,
          sessionId: target.sessionId,
          fromMessageId: target.fromMessageId ?? null,
        })

        queryClient.setQueryData<Session>(
          chatQueryKeys.session(forkedSession.id),
          forkedSession
        )
        queryClient.invalidateQueries({
          queryKey: chatQueryKeys.sessions(target.worktreeId),
        })
        queryClient.invalidateQueries({ queryKey: ['all-sessions'] })

        const chatStore = useChatStore.getState()
        chatStore.setActiveSession(target.worktreeId, forkedSession.id)
        chatStore.addUserInitiatedSession(forkedSession.id)

        toast.success(`Forked to ${forkedSession.name}`, { id: toastId })
      } catch (err) {
        toast.error(`Failed to fork session: ${err}`, { id: toastId })
      }
    },
    []
  )

  return { forkToWorktree, forkInPlace }
}
