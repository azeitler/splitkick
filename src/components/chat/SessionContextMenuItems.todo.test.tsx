import { screen, waitFor } from '@testing-library/react'
import { render } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { useChatStore } from '@/store/chat-store'
import type { Session } from '@/types/chat'
import { SessionContextMenuItems } from './SessionContextMenuItems'
import type { SessionCardData } from './session-card-utils'

const setSessionTodoMock = vi.fn()

vi.mock('./session-todo-actions', async importOriginal => ({
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  ...(await importOriginal<typeof import('./session-todo-actions')>()),
  toggleSessionTodo: (session: Session, worktreeId: string) =>
    setSessionTodoMock({
      sessionId: session.id,
      worktreeId,
      todo: !session.todo_at,
    }),
}))

function renderMenu(todoAt?: number) {
  const session = {
    id: 'session-a',
    name: 'Investigation',
    order: 0,
    created_at: 1,
    updated_at: 1,
    messages: [],
    todo_at: todoAt,
  } as Session
  const card = {
    session,
    status: 'idle',
    automaticStatus: 'idle',
    statusOverride: null,
    label: null,
  } as SessionCardData
  return render(
    <ContextMenu>
      <ContextMenuTrigger>
        <span>session row</span>
      </ContextMenuTrigger>
      <SessionContextMenuItems
        card={card}
        worktreeId="worktree-1"
        onRename={vi.fn()}
        onManageLabels={vi.fn()}
        onArchive={vi.fn()}
        onDelete={vi.fn()}
      />
    </ContextMenu>
  )
}

async function openMenu() {
  const user = userEvent.setup()
  await user.pointer({
    keys: '[MouseRight]',
    target: screen.getByText('session row'),
  })
  return user
}

describe('SessionContextMenuItems — To-Do', () => {
  beforeEach(() => {
    setSessionTodoMock.mockReset()
    useChatStore.setState({ sessionLabels: {} })
  })

  it('marks an unmarked session, also without a project', async () => {
    renderMenu()
    const user = await openMenu()

    await user.click(await screen.findByText('Mark as To-Do'))

    await waitFor(() =>
      expect(setSessionTodoMock).toHaveBeenCalledWith({
        sessionId: 'session-a',
        worktreeId: 'worktree-1',
        todo: true,
      })
    )
  })

  it('offers Clear To-Do on a marked session', async () => {
    renderMenu(1_700_000_000)
    const user = await openMenu()

    expect(screen.queryByText('Mark as To-Do')).not.toBeInTheDocument()
    await user.click(await screen.findByText('Clear To-Do'))

    await waitFor(() =>
      expect(setSessionTodoMock).toHaveBeenCalledWith(
        expect.objectContaining({ todo: false })
      )
    )
  })
})
