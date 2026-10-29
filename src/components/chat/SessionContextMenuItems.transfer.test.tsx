import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { useUIStore } from '@/store/ui-store'
import type { Session } from '@/types/chat'
import { SessionContextMenuItems } from './SessionContextMenuItems'
import type { SessionCardData } from './session-card-utils'

const { isNativeApp, connections } = vi.hoisted(() => ({
  isNativeApp: vi.fn(() => true),
  connections: {
    list: [] as { id: string; name: string; url: string; token: string }[],
  },
}))

vi.mock('./hooks/useSessionFork', () => ({
  useSessionFork: () => ({ forkInPlace: vi.fn(), forkToWorktree: vi.fn() }),
}))
vi.mock('@/lib/environment', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isNativeApp,
}))
vi.mock('@/lib/remote-connections', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getActiveConnectionId: () => 'local',
  useRemoteConnections: () => connections.list,
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

describe('SessionContextMenuItems — transfer', () => {
  beforeEach(() => {
    isNativeApp.mockReturnValue(true)
    connections.list = [{ id: 'studio', name: 'Studio', url: 'u', token: 't' }]
    useUIStore.setState({ transferSessionTarget: null })
  })

  it('opens the transfer dialog for this session', async () => {
    const user = await openMenu()

    await user.click(
      await screen.findByRole('menuitem', { name: /transfer to remote/i })
    )

    await waitFor(() =>
      expect(useUIStore.getState().transferSessionTarget).toEqual({
        worktreeId: 'worktree-1',
        sessionId: 'session-a',
      })
    )
  })

  it('is hidden without another connection', async () => {
    connections.list = []
    await openMenu()

    await screen.findByRole('menuitem', { name: /fork session \(same/i })
    expect(
      screen.queryByRole('menuitem', { name: /transfer to remote/i })
    ).toBeNull()
  })

  it('is shown in Web Access', async () => {
    isNativeApp.mockReturnValue(false)
    await openMenu()

    expect(
      await screen.findByRole('menuitem', { name: /transfer to remote/i })
    ).toBeTruthy()
  })
})
