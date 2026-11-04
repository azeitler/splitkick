import { Bot } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAgentProfile } from './agent-utils'

interface AgentBadgeProps {
  agentId: string | null | undefined
  /** Name of the session the badge sits next to. */
  sessionName?: string | null
  className?: string
}

/**
 * The agent a session was started from. A pill with the agent name in its
 * colour when the session was renamed; only the bot glyph when the session
 * still has the agent's name. Nothing for an unknown agent.
 */
export function AgentBadge({
  agentId,
  sessionName,
  className,
}: AgentBadgeProps) {
  const agent = useAgentProfile(agentId)
  if (!agent) return null
  const title = `Started from agent ${agent.name}`

  if (sessionName?.trim() === agent.name.trim()) {
    return (
      <span
        data-testid="agent-glyph"
        title={title}
        aria-label={title}
        className={cn('inline-flex shrink-0', className)}
        style={{ color: agent.color }}
      >
        <Bot className="size-3.5" aria-hidden="true" />
      </span>
    )
  }

  return (
    <span
      data-testid="agent-badge"
      title={title}
      className={cn(
        'inline-flex h-4 max-w-32 shrink-0 items-center gap-0.5 rounded border px-1 text-[10px] font-medium leading-none',
        className
      )}
      style={{
        color: agent.color,
        borderColor: `${agent.color}66`,
        backgroundColor: `${agent.color}14`,
      }}
    >
      <Bot className="size-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{agent.name}</span>
    </span>
  )
}
