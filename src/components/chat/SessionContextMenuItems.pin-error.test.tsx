import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { useProjectsStore } from '@/store/projects-store'
import { useChatStore } from '@/store/chat-store'
import type { Session } from '@/types/chat'
import { SessionContextMenuItems } from './SessionContextMenuItems'
import type { SessionCardData } from './session-card-utils'

const flushUIStateMock = vi.fn<() => Promise<void>>()
const toastErrorMock = vi.fn()

vi.mock('@/lib/ui-state-flush', () => ({
  flushUIState: () => flushUIStateMock(),
}))

vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
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
        projectId="project-1"
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

// A pin that does not reach disk used to stay on screen until the next start.
describe('SessionContextMenuItems — failed pin or star', () => {
  beforeEach(() => {
    flushUIStateMock.mockReset()
    flushUIStateMock.mockRejectedValue(new Error('os error 13'))
    toastErrorMock.mockReset()
    useProjectsStore.setState({
      projectCanvasSettings: {},
      starredSessions: [],
    })
    useChatStore.setState({ sessionLabels: {} })
  })

  it('drops the pin again and shows the error', async () => {
    const user = await openMenu()

    await user.click(await screen.findByText('Pin to Project'))

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith('Failed to pin session', {
        description: 'os error 13',
      })
    )
    expect(
      useProjectsStore.getState().projectCanvasSettings['project-1']
        ?.pinnedSessions
    ).toEqual([])
  })

  it('drops the star again and shows the error', async () => {
    const user = await openMenu()

    await user.click(await screen.findByRole('menuitem', { name: 'Star' }))

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith('Failed to star session', {
        description: 'os error 13',
      })
    )
    expect(useProjectsStore.getState().starredSessions).toEqual([])
  })
})
