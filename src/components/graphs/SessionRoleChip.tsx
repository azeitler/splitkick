import { Bot, Pencil } from 'lucide-react'
import { useUIStore } from '@/store/ui-store'
import type { Session } from '@/types/chat'
import { effectivePermission, useRoleProfile } from './role-utils'

/**
 * Agent chip in a session header: "Name · level ✎" in the agent colour.
 * Click opens Settings → Agents on that profile. Nothing without an agent.
 */
export function SessionRoleChip({
  session,
}: {
  session: Pick<Session, 'role_id' | 'graph_permission'> | null
}) {
  const agent = useRoleProfile(session?.role_id)
  if (!session || !agent) return null
  const permission = effectivePermission(session.graph_permission, agent)
  return (
    <button
      type="button"
      data-testid="session-agent-chip"
      title={`Role: ${agent.name}. Edit role`}
      onClick={() => useUIStore.getState().openRoleEditor(agent.id)}
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
