import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@/test/test-utils'
import type { Session } from '@/types/chat'
import { SessionTodoToggle } from './SessionTodoToggle'

const native = vi.hoisted(() => ({ value: true }))
const toggleMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/environment', async importOriginal => ({
  ...(await importOriginal<object>()),
  isNativeApp: () => native.value,
}))

vi.mock('./session-todo-actions', () => ({
  toggleSessionTodo: toggleMock,
}))

const session = (todoAt?: number) =>
  ({ id: 'session-a', todo_at: todoAt }) as Pick<Session, 'id' | 'todo_at'>

describe('SessionTodoToggle', () => {
  beforeEach(() => {
    native.value = true
    toggleMock.mockReset()
  })

  it('renders nothing without a session', () => {
    render(<SessionTodoToggle session={null} worktreeId="w-1" />)
    expect(screen.queryByTestId('session-todo-toggle')).toBeNull()
  })

  it('marks an unmarked session', async () => {
    const user = userEvent.setup()
    render(<SessionTodoToggle session={session()} worktreeId="w-1" />)

    const button = screen.getByRole('button', { name: 'Mark as To-Do' })
    expect(button).toHaveAttribute('aria-pressed', 'false')
    await user.click(button)

    expect(toggleMock).toHaveBeenCalledWith(session(), 'w-1')
  })

  it('is pressed on a marked session and offers to clear it', () => {
    render(<SessionTodoToggle session={session(42)} worktreeId="w-1" />)
    expect(screen.getByRole('button', { name: 'Clear To-Do' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
  })

  it('shows the shortcut hint only in the native app', async () => {
    const user = userEvent.setup()
    const { unmount } = render(
      <SessionTodoToggle session={session()} worktreeId="w-1" />
    )
    await user.hover(screen.getByTestId('session-todo-toggle'))
    expect((await screen.findAllByRole('tooltip'))[0]).toHaveTextContent(/L/)
    unmount()

    native.value = false
    render(<SessionTodoToggle session={session()} worktreeId="w-1" />)
    await user.hover(screen.getByTestId('session-todo-toggle'))
    const tooltip = (await screen.findAllByRole('tooltip'))[0]
    expect(tooltip).toHaveTextContent('Mark as To-Do')
    expect(tooltip?.querySelector('kbd')).toBeNull()
  })
})
