import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@/test/test-utils'
import { useChatStore } from '@/store/chat-store'
import type { AllSessionsEntry, Session } from '@/types/chat'
import { TodoSessionsSection } from './TodoSessionsSection'

const mocks = vi.hoisted(() => ({
  entries: [] as AllSessionsEntry[],
  navigateToSession: vi.fn(),
  setSessionTodo: vi.fn(),
}))

vi.mock('@/services/chat', async importOriginal => ({
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  ...(await importOriginal<typeof import('@/services/chat')>()),
  useAllSessions: () => ({ data: { entries: mocks.entries } }),
}))

vi.mock('@/lib/navigate-to-session', () => ({
  navigateToSession: mocks.navigateToSession,
}))

vi.mock('@/components/chat/session-todo-actions', async importOriginal => ({
  ...(await importOriginal<object>()),
  setSessionTodo: mocks.setSessionTodo,
}))

const NOW_SECS = Math.floor(Date.now() / 1000)

function session(id: string, name: string, todoAt?: number): Session {
  return {
    id,
    name,
    order: 0,
    created_at: 1,
    updated_at: 1,
    messages: [],
    todo_at: todoAt,
  } as Session
}

describe('TodoSessionsSection (Home)', () => {
  beforeEach(() => {
    mocks.navigateToSession.mockClear()
    mocks.setSessionTodo.mockClear()
    useChatStore.setState({ sessionLabels: {} })
    mocks.entries = [
      {
        project_id: 'p-1',
        project_name: 'Jean',
        worktree_id: 'w-1',
        worktree_name: 'main',
        worktree_path: '/tmp/main',
        sessions: [
          session('s-1', 'Older', NOW_SECS - 2 * 86400),
          session('s-2', 'Newer', NOW_SECS - 120),
          session('s-3', 'Plain'),
        ],
      },
    ]
  })

  it('hides while nothing is marked', () => {
    mocks.entries = []
    render(<TodoSessionsSection />)
    expect(screen.queryByTestId('home-todo-sessions')).toBeNull()
  })

  it('shows the marked sessions, newest first, with when they were marked', () => {
    render(<TodoSessionsSection />)

    expect(screen.getByText('To-Do (2)')).toBeInTheDocument()
    const rows = screen.getAllByTestId('home-todo-row')
    expect(rows[0]).toHaveTextContent('Newer')
    expect(rows[0]).toHaveTextContent('Jean / main')
    expect(rows[0]).toHaveTextContent(/marked 2m ago \(.+\)/)
    expect(rows[1]).toHaveTextContent(/marked 2d ago \(.+\)/)
    expect(screen.queryByText('Plain')).toBeNull()
  })

  it('opens a session and clears a mark', async () => {
    const user = userEvent.setup()
    render(<TodoSessionsSection />)

    await user.click(screen.getByText('Newer'))
    expect(mocks.navigateToSession).toHaveBeenCalledWith({
      projectId: 'p-1',
      worktreeId: 'w-1',
      sessionId: 's-2',
    })

    await user.click(
      screen.getAllByTestId('todo-done-button')[1] as HTMLElement
    )
    expect(mocks.setSessionTodo).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 's-1', todo: false })
    )
  })

  it('opens the session menu on a right-click', async () => {
    const user = userEvent.setup()
    render(<TodoSessionsSection />)

    fireEvent.contextMenu(screen.getByText('Newer'))
    expect(
      await screen.findByRole('menuitem', { name: /Rename/ })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('menuitem', { name: /Archive/ })
    ).toBeInTheDocument()

    await user.click(screen.getByRole('menuitem', { name: /Rename/ }))
    expect(await screen.findByLabelText('Session name')).toHaveValue('Newer')
  })
})
