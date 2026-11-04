import { Workflow } from 'lucide-react'
import { ShortcutHint } from '@/components/toolbar/WindowToolbar'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/store/chat-store'
import type { Session } from '@/types/chat'
import { sessionHasGraphPanel } from './SessionGraphPanel'

/**
 * The "Graph" header button of a session (session window and full chat
 * view). Hidden for a session without a graph link: the panel would be empty.
 */
export function SessionGraphToggle({
  session,
}: {
  session: Pick<Session, 'serves' | 'agent_id'> | null | undefined
}) {
  const visible = useChatStore(state => state.graphPanelVisible)
  if (!sessionHasGraphPanel(session)) return null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn('h-7 px-2 text-xs', visible && 'bg-accent')}
          aria-label="Toggle graph panel"
          aria-pressed={visible}
          data-testid="session-graph-toggle"
          onClick={() => useChatStore.getState().toggleGraphPanel()}
        >
          <Workflow className="h-3 w-3" />
          Graph
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        Graph panel
        <ShortcutHint action="toggle_session_graph" />
      </TooltipContent>
    </Tooltip>
  )
}
