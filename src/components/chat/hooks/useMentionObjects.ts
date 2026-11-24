import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { hasBackend } from '@/lib/environment'
import { invoke } from '@/lib/transport'
import { agentsQueryKeys } from '@/services/agents'
import { useAllSessions } from '@/services/chat'
import { useProjects } from '@/services/projects'
import type { Agent } from '@/types/agents'
import {
  buildMentionObjects,
  createMentionFuse,
  type MentionConnection,
} from '../mention-objects'

/**
 * The objects the `@` picker offers, from lists other views already cache.
 * Nothing loads while the picker is closed.
 *
 * Connections come from the backend (`list_remote_connections`), not from
 * this client: those are the ids that `list_instances` and `remote_tool`
 * accept. In Web Access that is the server's list, not the browser's.
 */
export function useMentionObjects({
  open,
  currentProjectId,
  currentSessionId,
}: {
  open: boolean
  currentProjectId: string | null
  currentSessionId: string | null
}) {
  const enabled = open && hasBackend()
  const { data: projects } = useProjects()
  const { data: allSessions } = useAllSessions(enabled)
  const { data: agents } = useQuery({
    queryKey: agentsQueryKeys.all,
    queryFn: () => invoke<Agent[]>('list_agents'),
    enabled,
  })
  const { data: connections } = useQuery({
    queryKey: ['remote-connections', 'mentions'],
    queryFn: () => invoke<MentionConnection[]>('list_remote_connections'),
    enabled,
    staleTime: 30_000,
  })

  return useMemo(() => {
    const groups = buildMentionObjects({
      entries: allSessions?.entries ?? [],
      projects: projects ?? [],
      agents: agents ?? [],
      connections: connections ?? [],
      currentProjectId,
      currentSessionId,
    })
    // One index per group, built when the lists change, not per keystroke.
    return {
      session: {
        items: groups.session,
        fuse: createMentionFuse(groups.session),
      },
      project: {
        items: groups.project,
        fuse: createMentionFuse(groups.project),
      },
      worktree: {
        items: groups.worktree,
        fuse: createMentionFuse(groups.worktree),
      },
      agent: { items: groups.agent, fuse: createMentionFuse(groups.agent) },
      connection: {
        items: groups.connection,
        fuse: createMentionFuse(groups.connection),
      },
    }
  }, [
    allSessions,
    projects,
    agents,
    connections,
    currentProjectId,
    currentSessionId,
  ])
}
