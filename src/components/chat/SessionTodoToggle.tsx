import { ListTodo } from 'lucide-react'
import { ShortcutHint } from '@/components/toolbar/WindowToolbar'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { Session } from '@/types/chat'
import { toggleSessionTodo } from './session-todo-actions'

/**
 * The To-Do header button of a session (#125): marks the open session as
 * To-Do, or clears the mark. Pressed while the session is on the list.
 */
export function SessionTodoToggle({
  session,
  worktreeId,
}: {
  session: Pick<Session, 'id' | 'todo_at'> | null | undefined
  worktreeId: string
}) {
  if (!session) return null
  const marked = !!session.todo_at

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn('h-7 px-2 text-xs', marked && 'bg-accent text-sky-500')}
          aria-label={marked ? 'Clear To-Do' : 'Mark as To-Do'}
          aria-pressed={marked}
          data-testid="session-todo-toggle"
          onClick={() => void toggleSessionTodo(session, worktreeId)}
        >
          <ListTodo className="h-3 w-3" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {marked ? 'Clear To-Do' : 'Mark as To-Do'}
        <ShortcutHint action="toggle_session_todo" />
      </TooltipContent>
    </Tooltip>
  )
}
