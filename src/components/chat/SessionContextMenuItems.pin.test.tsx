import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { useProjectsStore } from '@/store/projects-store'
import { useChatStore } from '@/store/chat-store'
import type { Session } from '@/types/chat'
import { SessionContextMenuItems } from './SessionContextMenuItems'
import type { SessionCardData } from './session-card-utils'

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

function renderMenu(projectId?: string) {
  return render(
    <ContextMenu>
      <ContextMenuTrigger>
        <span>session row</span>
      </ContextMenuTrigger>
      <SessionContextMenuItems
        card={card}
        worktreeId="worktree-1"
        projectId={projectId}
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

describe('SessionContextMenuItems — pin to project', () => {
  beforeEach(() => {
    useProjectsStore.setState({ projectCanvasSettings: {} })
    useChatStore.setState({ sessionLabels: {} })
  })

  it('pins the session to the project with its worktree id', async () => {
    renderMenu('project-1')
    const user = await openMenu()

    await user.click(await screen.findByText('Pin to Project'))

    expect(
      useProjectsStore.getState().projectCanvasSettings['project-1']
        ?.pinnedSessions
    ).toEqual([{ sessionId: 'session-a', worktreeId: 'worktree-1' }])
  })

  it('offers unpin once the session is pinned, and unpins it', async () => {
    useProjectsStore
      .getState()
      .pinSessionToProject('project-1', 'session-a', 'worktree-1')

    renderMenu('project-1')
    const user = await openMenu()

    expect(screen.queryByText('Pin to Project')).not.toBeInTheDocument()
    await user.click(await screen.findByText('Unpin from Project'))

    expect(
      useProjectsStore.getState().projectCanvasSettings['project-1']
        ?.pinnedSessions
    ).toEqual([])
  })

  it('hides the pin item on surfaces without a project', async () => {
    renderMenu(undefined)
    await openMenu()

    // The menu is open — another item proves it.
    expect(await screen.findByText('Rename')).toBeInTheDocument()
    expect(screen.queryByText('Pin to Project')).not.toBeInTheDocument()
    expect(screen.queryByText('Unpin from Project')).not.toBeInTheDocument()
  })
})
