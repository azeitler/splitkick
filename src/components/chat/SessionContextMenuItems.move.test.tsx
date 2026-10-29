import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'
import type { QueuedMessage, Session } from '@/types/chat'
import { SessionContextMenuItems } from './SessionContextMenuItems'
import type { SessionCardData } from './session-card-utils'

vi.mock('./hooks/useSessionFork', () => ({
  useSessionFork: () => ({ forkInPlace: vi.fn(), forkToWorktree: vi.fn() }),
}))

const session = {
  id: 'session-a',
  name: 'Investigation',
  order: 0,
  created_at: 1,
  updated_at: 1,
  messages: [],
} as Session

function cardWith(overrides: Partial<SessionCardData> = {}): SessionCardData {
  return {
    session,
    status: 'idle',
    automaticStatus: 'idle',
    statusOverride: null,
    label: null,
    isSending: false,
    ...overrides,
  } as SessionCardData
}

async function openMenu(card = cardWith()) {
  render(
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
  const user = userEvent.setup()
  await user.pointer({
    keys: '[MouseRight]',
    target: screen.getByText('session row'),
  })
  return user
}

describe('SessionContextMenuItems — move', () => {
  beforeEach(() => {
    useUIStore.setState({ moveSessionTarget: null })
    useChatStore.setState({ messageQueues: {} })
  })

  it('opens the move dialog for this session', async () => {
    const user = await openMenu()

    await user.click(await screen.findByRole('menuitem', { name: /move to/i }))

    await waitFor(() =>
      expect(useUIStore.getState().moveSessionTarget).toEqual({
        worktreeId: 'worktree-1',
        sessionId: 'session-a',
      })
    )
  })

  it('is disabled while the session runs', async () => {
    await openMenu(cardWith({ isSending: true }))

    const item = await screen.findByRole('menuitem', { name: /move to/i })
    expect(item).toHaveAttribute('aria-disabled', 'true')
  })

  it('is disabled while messages are queued', async () => {
    useChatStore.setState({
      messageQueues: { 'session-a': [{ id: 'q1' } as QueuedMessage] },
    })
    await openMenu()

    const item = await screen.findByRole('menuitem', { name: /move to/i })
    expect(item).toHaveAttribute('aria-disabled', 'true')
  })
})
