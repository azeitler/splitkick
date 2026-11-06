import { Workflow } from 'lucide-react'
import { ShortcutHint } from '@/components/toolbar/WindowToolbar'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/store/ui-store'
import type { Session } from '@/types/chat'
import { sessionHasGraphPanel } from './SessionGraphPanel'

/**
 * The "Graph" header button of a session (session window and full chat
 * view): opens or closes the left panel on its Graph tab (#98). Hidden for a
 * session without a graph link; ⌘K "Toggle Graph Panel" still reaches it.
 */
export function SessionGraphToggle({
  session,
}: {
  session: Pick<Session, 'serves' | 'agent_id'> | null | undefined
}) {
  const visible = useUIStore(
    state => state.fileBrowserVisible && state.contextPanelTab === 'graph'
  )
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
          onClick={() => useUIStore.getState().toggleContextPanel('graph')}
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
