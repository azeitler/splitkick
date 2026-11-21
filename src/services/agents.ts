import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { hasBackend } from '@/lib/environment'
import { navigateToSession } from '@/lib/navigate-to-session'
import { invoke } from '@/lib/transport'
import type { Agent } from '@/types/agents'

/**
 * Agents: named, unique sessions in a role. The backend emits
 * `cache:invalidate` `["agents"]` on every change, so all clients follow.
 */
export const agentsQueryKeys = {
  all: ['agents'] as const,
}

export function useAgents() {
  return useQuery({
    queryKey: agentsQueryKeys.all,
    queryFn: () => invoke<Agent[]>('list_agents'),
    enabled: hasBackend(),
  })
}

/** The agent whose current session is `sessionId`, if any. */
export function useAgentForSession(
  sessionId: string | null | undefined
): Agent | undefined {
  const { data } = useAgents()
  return useMemo(
    () => (sessionId ? data?.find(a => a.sessionId === sessionId) : undefined),
    [data, sessionId]
  )
}

/**
 * `errorTitle` null: the caller shows the error itself (the agent dialog puts
 * it at the name field).
 */
function useAgentCommand<TArgs extends Record<string, unknown>, TResult>(
  command: string,
  errorTitle: string | null
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (args: TArgs) => invoke<TResult>(command, args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentsQueryKeys.all })
    },
    onError: error => {
      if (errorTitle) toast.error(errorTitle, { description: String(error) })
    },
  })
}

export const useCreateAgent = () =>
  useAgentCommand<
    {
      name: string
      projectId?: string
      roleId?: string
      folder?: string
    },
    Agent
  >('create_agent', null)

export const useMakeSessionAgent = () =>
  useAgentCommand<{ sessionId: string; name: string; global: boolean }, Agent>(
    'make_session_agent',
    null
  )

/** `roleId`: leave out to keep the role, null to clear it. */
export const useUpdateAgent = () =>
  useAgentCommand<
    { agentId: string; name?: string; roleId?: string | null },
    Agent
  >('update_agent', 'Could not change the agent')

export const useRemoveAgent = () =>
  useAgentCommand<{ agentId: string }, null>(
    'remove_agent',
    'Could not remove the agent'
  )

/**
 * Start the agent again in a fresh session. Its first message hands over the
 * history of the old session, which stays as a normal session.
 */
export function useRestartAgent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (args: { agentId: string }) =>
      invoke<Agent>('restart_agent', args),
    onMutate: () => ({ toastId: toast.loading('Restarting agent…') }),
    onSuccess: (agent, _args, context) => {
      queryClient.invalidateQueries({ queryKey: agentsQueryKeys.all })
      queryClient.invalidateQueries({ queryKey: ['all-sessions'] })
      const { projectId, worktreeId, sessionId } = agent
      toast.success(`${agent.name} restarted in a fresh session`, {
        id: context?.toastId,
        action:
          projectId && sessionId
            ? {
                label: 'Open',
                onClick: () =>
                  navigateToSession({ projectId, worktreeId, sessionId }),
              }
            : undefined,
      })
    },
    onError: (error, _args, context) => {
      toast.error('Could not restart the agent', {
        id: context?.toastId,
        description: String(error),
      })
    },
  })
}
