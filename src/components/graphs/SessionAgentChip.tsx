import { Bot, Pencil } from 'lucide-react'
import { useUIStore } from '@/store/ui-store'
import type { Session } from '@/types/chat'
import { effectivePermission, useAgentProfile } from './agent-utils'

/**
 * Agent chip in a session header: "Name · level ✎" in the agent colour.
 * Click opens Settings → Agents on that profile. Nothing without an agent.
 */
export function SessionAgentChip({
  session,
}: {
  session: Pick<Session, 'agent_id' | 'graph_permission'> | null
}) {
  const agent = useAgentProfile(session?.agent_id)
  if (!session || !agent) return null
  const permission = effectivePermission(session.graph_permission, agent)
  return (
    <button
      type="button"
      data-testid="session-agent-chip"
      title={`Started from agent ${agent.name}. Edit profile`}
      onClick={() => useUIStore.getState().openAgentEditor(agent.id)}
      className="inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium hover:opacity-80"
      style={{ color: agent.color, borderColor: `${agent.color}66` }}
    >
      <Bot className="size-3" aria-hidden="true" />
      {agent.name}
      <span className="opacity-70">· {permission}</span>
      <Pencil className="size-2.5" aria-hidden="true" />
    </button>
  )
}
