import { screen, waitFor } from '@testing-library/react'
import { render } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { useUIStore } from '@/store/ui-store'
import type { Session } from '@/types/chat'
import { SessionContextMenuItems } from './SessionContextMenuItems'
import type { SessionCardData } from './session-card-utils'

vi.mock('./hooks/useSessionFork', () => ({
  useSessionFork: () => ({ forkInPlace: vi.fn(), forkToWorktree: vi.fn() }),
}))

async function openMenu(session: Session) {
  const card = {
    session,
    status: 'idle',
    automaticStatus: 'idle',
    statusOverride: null,
    label: null,
    isSending: false,
  } as SessionCardData
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

const base = {
  id: 'session-a',
  name: 'Investigation',
  order: 0,
  created_at: 1,
  updated_at: 1,
  messages: [],
} as Session

describe('SessionContextMenuItems — Link to Graph… (#88)', () => {
  beforeEach(() => {
    useUIStore.setState({ linkToGraphTarget: null })
  })

  it('shows for a session without a graph link and opens the picker', async () => {
    const user = await openMenu(base)

    await user.click(
      await screen.findByRole('menuitem', { name: /link to graph/i })
    )

    await waitFor(() =>
      expect(useUIStore.getState().linkToGraphTarget).toEqual({
        sessionId: 'session-a',
        sessionName: 'Investigation',
        serves: [],
      })
    )
  })

  it('passes the current links of a linked session', async () => {
    const user = await openMenu({ ...base, serves: ['g1#n1', 'g2'] })

    await user.click(
      await screen.findByRole('menuitem', { name: /link to graph/i })
    )

    await waitFor(() =>
      expect(useUIStore.getState().linkToGraphTarget?.serves).toEqual([
        'g1#n1',
        'g2',
      ])
    )
  })
})
