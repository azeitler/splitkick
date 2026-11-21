import { BotMessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAgentForSession } from '@/services/agents'

/**
 * Marks the session of an agent with the agent's name. Only the glyph when
 * the session carries the agent's name already. Nothing for other sessions.
 */
export function AgentBadge({
  sessionId,
  sessionName,
  className,
}: {
  sessionId: string
  sessionName?: string | null
  className?: string
}) {
  const agent = useAgentForSession(sessionId)
  if (!agent) return null
  const title = `Agent: ${agent.name}`
  const sameName = sessionName?.trim() === agent.name.trim()

  return (
    <span
      data-testid="agent-name-badge"
      title={title}
      aria-label={sameName ? title : undefined}
      className={cn(
        'inline-flex shrink-0 items-center text-foreground/80',
        !sameName &&
          'h-4 max-w-32 gap-0.5 rounded border border-foreground/25 bg-foreground/5 px-1 text-[10px] font-medium leading-none',
        className
      )}
    >
      <BotMessageSquare
        className={cn('shrink-0', sameName ? 'size-3.5' : 'size-3')}
        aria-hidden="true"
      />
      {!sameName && <span className="truncate">{agent.name}</span>}
    </span>
  )
}
