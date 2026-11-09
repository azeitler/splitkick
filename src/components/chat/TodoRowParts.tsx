import { Check } from 'lucide-react'
import { formatMessageTimestamp, formatRelativeTime } from '@/lib/relative-time'
import { cn } from '@/lib/utils'
import type { SessionShortcut } from './SessionShortcutRows'
import { setSessionTodo } from './session-todo-actions'

/**
 * "marked 3h ago (14:02)": when a session went on the To-Do list (#125).
 * The narrow sidebar drops the word "marked".
 */
export function todoMarkedText(
  todoAt: number,
  { short = false, now = Date.now() }: { short?: boolean; now?: number } = {}
): string {
  const text = `${formatRelativeTime(todoAt, now)} (${formatMessageTimestamp(todoAt, now)})`
  return short ? text : `marked ${text}`
}

/** The check beside a To-Do row: clears the mark, so the row leaves the list. */
export function TodoDoneButton({
  shortcut,
  className,
}: {
  shortcut: Pick<SessionShortcut, 'sessionId' | 'worktreeId' | 'session'>
  className?: string
}) {
  return (
    <button
      type="button"
      aria-label={`Done: clear To-Do for ${shortcut.session.name || 'Untitled'}`}
      title="Done (clear To-Do)"
      data-testid="todo-done-button"
      className={cn(
        'flex size-5 items-center justify-center rounded border border-border/70 text-muted-foreground hover:border-emerald-500 hover:bg-emerald-500/10 hover:text-emerald-600',
        className
      )}
      onClick={event => {
        event.stopPropagation()
        void setSessionTodo({
          sessionId: shortcut.sessionId,
          worktreeId: shortcut.worktreeId,
          todo: false,
          previousTodoAt: shortcut.session.todo_at,
        })
      }}
    >
      <Check className="size-3" />
    </button>
  )
}
