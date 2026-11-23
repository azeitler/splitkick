import { fireEvent, screen, waitFor } from '@testing-library/react'
import { render } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import type { Session } from '@/types/chat'
import { SessionContextMenuItems } from './SessionContextMenuItems'
import type { SessionCardData } from './session-card-utils'

const forkInPlace = vi.fn()
const forkToWorktree = vi.fn()

vi.mock('./hooks/useSessionFork', () => ({
  useSessionFork: () => ({ forkInPlace, forkToWorktree }),
}))

const session = {
  id: 'session-a',
  name: 'Investigation',
  order: 0,
  created_at: 1,
  updated_at: 1,
  messages: [],
} as Session

const card = {
  session,
  status: 'idle',
  automaticStatus: 'idle',
  statusOverride: null,
  label: null,
} as SessionCardData

async function openMenu() {
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

/** Open the submenu by keyboard; a pointer move closes it again in jsdom. */
async function openForkSubmenu() {
  const trigger = await screen.findByRole('menuitem', { name: /^fork$/i })
  trigger.focus()
  fireEvent.keyDown(trigger, { key: 'ArrowRight' })
}

describe('SessionContextMenuItems — fork', () => {
  beforeEach(() => {
    forkInPlace.mockReset()
    forkToWorktree.mockReset()
  })

  it('groups both forks in a Fork submenu', async () => {
    await openMenu()
    await openForkSubmenu()
    const items = await screen.findAllByRole('menuitem')
    const names = items.map(item => item.textContent)
    expect(names).toContain('Same Worktree')
    expect(names).toContain('New Worktree')
    expect(names).not.toContain('Fork Session (same Worktree)')
  })

  it('forks into a sibling session in the same worktree', async () => {
    const user = await openMenu()
    await openForkSubmenu()

    await user.click(
      await screen.findByRole('menuitem', {
        name: 'Same Worktree',
      })
    )

    await waitFor(() => {
      expect(forkInPlace).toHaveBeenCalledWith({
        worktreeId: 'worktree-1',
        sessionId: 'session-a',
      })
    })
    expect(forkToWorktree).not.toHaveBeenCalled()
  })

  it('forks into a new worktree', async () => {
    const user = await openMenu()
    await openForkSubmenu()

    await user.click(
      await screen.findByRole('menuitem', {
        name: 'New Worktree',
      })
    )

    await waitFor(() => {
      expect(forkToWorktree).toHaveBeenCalledWith({
        worktreeId: 'worktree-1',
        sessionId: 'session-a',
      })
    })
    expect(forkInPlace).not.toHaveBeenCalled()
  })
})
