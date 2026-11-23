import { screen } from '@testing-library/react'
import { render } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { useChatStore } from '@/store/chat-store'
import type { Session } from '@/types/chat'
import { SessionContextMenuItems } from './SessionContextMenuItems'
import type { SessionCardData } from './session-card-utils'

function renderMenu(statusOverride: SessionCardData['statusOverride']) {
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
    statusOverride,
    label: null,
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
}

async function openMenu() {
  const user = userEvent.setup()
  await user.pointer({
    keys: '[MouseRight]',
    target: screen.getByText('session row'),
  })
  return user
}

describe('SessionContextMenuItems — Mark as Complete', () => {
  const setOverride = vi.fn()
  beforeEach(() => {
    setOverride.mockReset()
    useChatStore.setState({ setSessionStatusOverride: setOverride })
  })

  it('sits above Set Status and marks the session completed', async () => {
    renderMenu(null)
    const user = await openMenu()
    const items = (await screen.findAllByRole('menuitem')).map(
      item => item.textContent
    )
    const complete = items.indexOf('Mark as Complete')
    expect(complete).toBeGreaterThanOrEqual(0)
    expect(items[complete + 1]).toContain('Set Status')

    await user.click(screen.getByRole('menuitem', { name: 'Mark as Complete' }))
    expect(setOverride).toHaveBeenCalledWith('session-a', 'completed')
  })

  it('clears the completed status of a completed session', async () => {
    renderMenu('completed')
    const user = await openMenu()
    await user.click(
      await screen.findByRole('menuitem', { name: 'Mark as Incomplete' })
    )
    expect(setOverride).toHaveBeenCalledWith('session-a', null)
  })
})
