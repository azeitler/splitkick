import { useEffect, useEffectEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { invoke } from '@/lib/transport'
import {
  DEBUG_SESSION_EVENT,
  buildDebugPrompt,
  debugSessionName,
  type DebugSessionRequest,
} from '@/lib/debug-session'
import { navigateToSession } from '@/lib/navigate-to-session'
import { useCreateSession, useSendMessage } from '@/services/chat'
import { projectsQueryKeys } from '@/services/projects'
import { useChatStore } from '@/store/chat-store'
import type { Worktree } from '@/types/projects'

async function resolveTarget(
  request: DebugSessionRequest
): Promise<Worktree | null> {
  if (request.worktreeId) {
    return invoke<Worktree>('get_worktree', {
      worktreeId: request.worktreeId,
    })
  }
  if (request.projectId) {
    // Returns the existing base session when there is one.
    return invoke<Worktree>('create_base_session', {
      projectId: request.projectId,
    })
  }
  return null
}

/**
 * Handles "Debug in new Session" requests (#143): opens a new session in the
 * failed worktree (or the project's base session) and sends the error logs.
 * Mount once, in MainWindow.
 */
export function useDebugSessionListener() {
  const queryClient = useQueryClient()
  const createSession = useCreateSession()
  const sendMessage = useSendMessage()

  const startDebugSession = useEffectEvent(
    async (request: DebugSessionRequest) => {
      const toastId = toast.loading('Starting debug session…')
      try {
        const worktree = await resolveTarget(request)
        if (!worktree) throw new Error('No worktree to debug in')
        if (!request.worktreeId) {
          // A new base session must show up in the sidebar.
          queryClient.invalidateQueries({
            queryKey: projectsQueryKeys.worktrees(worktree.project_id),
          })
        }

        const store = useChatStore.getState()
        // Inherit backend/model/provider/mode from the session the user last
        // used in that worktree, else from the session in view.
        const baseSessionId =
          store.activeSessionIds[worktree.id] ??
          store.activeSessionIds[store.activeWorktreeId ?? '']

        const session = await createSession.mutateAsync({
          worktreeId: worktree.id,
          worktreePath: worktree.path,
          name: debugSessionName(request.kind),
        })
        if (baseSessionId) store.copySessionSettings(baseSessionId, session.id)

        const state = useChatStore.getState()
        navigateToSession({
          projectId: worktree.project_id,
          worktreeId: worktree.id,
          sessionId: session.id,
        })
        toast.dismiss(toastId)

        // Fire-and-forget: send_chat_message resolves only when the run ends.
        sendMessage.mutate({
          sessionId: session.id,
          worktreeId: worktree.id,
          worktreePath: worktree.path,
          message: buildDebugPrompt(request),
          executionMode: state.executionModes[session.id],
          backend:
            state.selectedBackends[session.id] ?? session.backend ?? undefined,
          model:
            state.selectedModels[session.id] ??
            session.selected_model ??
            undefined,
          customProfileName:
            state.selectedProviders[session.id] ??
            session.selected_provider ??
            undefined,
        })
      } catch (error) {
        toast.error(`Failed to start debug session: ${error}`, { id: toastId })
      }
    }
  )

  useEffect(() => {
    const handler = (event: Event) => {
      void startDebugSession((event as CustomEvent<DebugSessionRequest>).detail)
    }
    window.addEventListener(DEBUG_SESSION_EVENT, handler)
    return () => window.removeEventListener(DEBUG_SESSION_EVENT, handler)
  }, [])
}
