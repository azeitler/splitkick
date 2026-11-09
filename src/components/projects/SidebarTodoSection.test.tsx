import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@/test/test-utils'
import { useProjectsStore } from '@/store/projects-store'
import { useChatStore } from '@/store/chat-store'
import type { AllSessionsEntry, Session } from '@/types/chat'
import { SidebarTodoSection } from './SidebarTodoSection'

const mocks = vi.hoisted(() => ({
  entries: [] as AllSessionsEntry[],
  navigateToSession: vi.fn(),
  setSessionTodo: vi.fn(),
}))

vi.mock('@/services/chat', async importOriginal => ({
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  ...(await importOriginal<typeof import('@/services/chat')>()),
  useAllSessions: () => ({ data: { entries: mocks.entries } }),
  useRenameSession: () => ({ mutate: vi.fn() }),
  useArchiveSession: () => ({ mutate: vi.fn() }),
  useCloseSession: () => ({ mutate: vi.fn() }),
}))

vi.mock('@/lib/navigate-to-session', async importOriginal => ({
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  ...(await importOriginal<typeof import('@/lib/navigate-to-session')>()),
  navigateToSession: mocks.navigateToSession,
}))

vi.mock('@/components/chat/session-todo-actions', async importOriginal => ({
  ...(await importOriginal<object>()),
  setSessionTodo: mocks.setSessionTodo,
}))

function session(id: string, name: string, extra: Partial<Session> = {}) {
  return {
    id,
    name,
    order: 0,
    created_at: 1,
    updated_at: 1,
    messages: [],
    ...extra,
  } as Session
}

function entry(project: string, worktree: string, sessions: Session[]) {
  return {
    project_id: `id-${project}`,
    project_name: project,
    worktree_id: `id-${worktree}`,
    worktree_name: worktree,
    worktree_path: `/tmp/${worktree}`,
    sessions,
  }
}

const NOW_SECS = Math.floor(Date.now() / 1000)

describe('SidebarTodoSection', () => {
  beforeEach(() => {
    mocks.navigateToSession.mockClear()
    mocks.setSessionTodo.mockClear()
    mocks.entries = [
      entry('Jean', 'main', [
        session('s-1', 'Review PR', { todo_at: NOW_SECS - 3 * 3600 }),
        session('s-2', 'Not marked'),
      ]),
      entry('Coolify', 'feat/deploy', [
        session('s-3', 'Reply to comments', { todo_at: NOW_SECS - 60 }),
        session('s-4', 'Archived', {
          todo_at: NOW_SECS,
          archived_at: 5,
        } as Partial<Session>),
      ]),
    ]
    useProjectsStore.setState({
      starredSessions: [],
      todoSectionCollapsed: false,
      projectCanvasSettings: {},
    })
    useChatStore.setState({ sessionLabels: {}, activeSessionIds: {} })
  })

  it('renders nothing while nothing is marked', () => {
    mocks.entries = [entry('Jean', 'main', [session('s-2', 'Not marked')])]
    render(<SidebarTodoSection />)
    expect(screen.queryByTestId('sidebar-todo-section')).toBeNull()
  })

  it('lists marked sessions across projects, newest mark first', () => {
    render(<SidebarTodoSection />)

    const names = screen
      .getAllByRole('button', { name: /Review PR|Reply to comments/ })
      .filter(b => b.dataset.testid !== 'todo-done-button')
      .map(b => b.getAttribute('title'))
    expect(names).toEqual([
      'Reply to comments — Coolify / feat/deploy',
      'Review PR — Jean / main',
    ])
    expect(screen.queryByText('Archived')).toBeNull()
    // Time ago, with the full time in brackets.
    expect(screen.getByText(/^3h ago \(.+\)$/)).toBeInTheDocument()
    // Every row is a To-Do, so no row carries the glyph.
    expect(screen.queryByTestId('todo-glyph')).toBeNull()
  })

  it('opens the session on click', async () => {
    const user = userEvent.setup()
    render(<SidebarTodoSection />)

    await user.click(screen.getByTitle('Review PR — Jean / main'))

    expect(mocks.navigateToSession).toHaveBeenCalledWith(
      { projectId: 'id-Jean', worktreeId: 'id-main', sessionId: 's-1' },
      { revealInSidebar: false }
    )
  })

  it('the check clears the mark without opening the session', async () => {
    const user = userEvent.setup()
    render(<SidebarTodoSection />)

    const [first] = screen.getAllByTestId('todo-done-button')
    await user.click(first as HTMLElement)

    expect(mocks.setSessionTodo).toHaveBeenCalledWith({
      sessionId: 's-3',
      worktreeId: 'id-feat/deploy',
      todo: false,
      previousTodoAt: NOW_SECS - 60,
    })
    expect(mocks.navigateToSession).not.toHaveBeenCalled()
  })

  it('collapses to a count, and remembers it in the store', async () => {
    const user = userEvent.setup()
    render(<SidebarTodoSection />)

    await user.click(screen.getByTestId('sidebar-todo-toggle'))

    expect(useProjectsStore.getState().todoSectionCollapsed).toBe(true)
    expect(screen.getByTestId('collapsed-count-badge')).toHaveTextContent('2')
    expect(screen.queryByTitle('Review PR — Jean / main')).toBeNull()
  })
})
