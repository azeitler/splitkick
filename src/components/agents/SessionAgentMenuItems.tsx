import {
  BotMessageSquare,
  BotOff,
  CalendarClock,
  Pencil,
  RotateCcw,
} from 'lucide-react'
import {
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@/components/ui/context-menu'
import { useRoleProfiles } from '@/components/graphs/role-utils'
import {
  useAgentForSession,
  useRemoveAgent,
  useRestartAgent,
  useUpdateAgent,
} from '@/services/agents'
import { useUIStore } from '@/store/ui-store'

const NO_ROLE = '__none__'

/**
 * The agent items of a session's context menu. A normal session can become
 * an agent; the session of an agent can rename the agent, change its role,
 * restart it in a fresh session, or stop being one. Removing the agent keeps
 * the session.
 */
export function SessionAgentMenuItems({
  sessionId,
  sessionName,
}: {
  sessionId: string
  sessionName: string
}) {
  const agent = useAgentForSession(sessionId)
  const roles = useRoleProfiles()
  const updateAgent = useUpdateAgent()
  const removeAgent = useRemoveAgent()
  const restartAgent = useRestartAgent()

  if (!agent) {
    return (
      <ContextMenuItem
        onSelect={() =>
          useUIStore
            .getState()
            .setAgentDialog({ mode: 'make', sessionId, sessionName })
        }
      >
        <BotMessageSquare className="mr-2 h-4 w-4" />
        Make Agent…
      </ContextMenuItem>
    )
  }

  return (
    <>
      <ContextMenuItem
        onSelect={() =>
          useUIStore.getState().setAgentDialog({
            mode: 'rename',
            agentId: agent.id,
            name: agent.name,
          })
        }
      >
        <Pencil className="mr-2 h-4 w-4" />
        Rename Agent…
      </ContextMenuItem>
      {roles.length > 0 && (
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <BotMessageSquare className="mr-2 h-4 w-4" />
            Agent Role
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuRadioGroup
              value={agent.roleId ?? NO_ROLE}
              onValueChange={value =>
                updateAgent.mutate({
                  agentId: agent.id,
                  roleId: value === NO_ROLE ? null : value,
                })
              }
            >
              <ContextMenuRadioItem value={NO_ROLE}>
                No role
              </ContextMenuRadioItem>
              {roles.map(role => (
                <ContextMenuRadioItem key={role.id} value={role.id}>
                  {role.name}
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}
      {/* The schedule is the agent's: it follows the agent after a restart. */}
      <ContextMenuItem
        onSelect={() =>
          useUIStore.getState().setAgentDialog({
            mode: 'schedule',
            agentId: agent.id,
            sessionId,
            name: agent.name,
          })
        }
      >
        <CalendarClock className="mr-2 h-4 w-4" />
        New Schedule…
      </ContextMenuItem>
      {/* A fresh session takes over; this one stays as a normal session. */}
      <ContextMenuItem
        onSelect={() => restartAgent.mutate({ agentId: agent.id })}
      >
        <RotateCcw className="mr-2 h-4 w-4" />
        Restart Agent
      </ContextMenuItem>
      <ContextMenuItem
        onSelect={() => removeAgent.mutate({ agentId: agent.id })}
      >
        <BotOff className="mr-2 h-4 w-4" />
        Remove Agent
      </ContextMenuItem>
    </>
  )
}
