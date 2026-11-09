import { ListTodo } from 'lucide-react'

/** The small mark that shows a session is on the To-Do list (#125). */
export function TodoGlyph() {
  return (
    <ListTodo
      data-testid="todo-glyph"
      aria-label="To-Do"
      className="size-2.5 shrink-0 text-sky-500"
    />
  )
}
