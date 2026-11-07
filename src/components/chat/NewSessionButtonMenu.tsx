import { Bot } from 'lucide-react'
import {
  ContextMenuContent,
  ContextMenuItem,
} from '@/components/ui/context-menu'

/**
 * Right-click (long-press on touch) menu of a "New session" button (#109).
 * Put it in a `ContextMenu` whose `ContextMenuTrigger` is the button; a
 * plain click stays on the button's own handler.
 */
export function NewSessionButtonMenuContent({
  onNewAgentSession,
}: {
  onNewAgentSession: () => void
}) {
  return (
    <ContextMenuContent className="min-w-56">
      <ContextMenuItem onSelect={onNewAgentSession}>
        <Bot className="mr-2 h-4 w-4" />
        New Session from Agent…
      </ContextMenuItem>
    </ContextMenuContent>
  )
}
