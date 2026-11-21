import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { render } from '@/test/test-utils'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import type { Agent } from '@/types/agents'
import type { Session } from '@/types/chat'
import { SessionContextMenuItems } from './SessionContextMenuItems'
import type { SessionCardData } from './session-card-utils'

const mocks = vi.hoisted(() => ({
  agent: undefined as Agent | undefined,
  remove: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@/services/agents', () => ({
  useAgentForSession: () => mocks.agent,
  useRemoveAgent: () => ({ mutate: mocks.remove }),
  useUpdateAgent: () => ({ mutate: mocks.update }),
}))

vi.mock('@/components/graphs/role-utils', async importOriginal => ({
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  ...(await importOriginal<typeof import('@/components/graphs/role-utils')>()),
  useRoleProfiles: () => [{ id: 'r1', name: 'Reviewer' }],
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

const agent: Agent = {
  id: 'a1',
  name: 'Release manager',
  scope: 'project',
  projectId: 'project-1',
  projectName: 'Splitkick',
  roleId: null,
  worktreeId: 'worktree-1',
  worktreePath: '/tmp/w',
  sessionId: 'session-a',
  sessionName: 'Investigation',
  pastSessionIds: [],
  createdAt: 0,
}

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

describe('SessionContextMenuItems — agents', () => {
  beforeEach(() => {
    mocks.agent = undefined
    mocks.remove.mockClear()
    mocks.update.mockClear()
    useProjectsStore.setState({ projectCanvasSettings: {} })
    useChatStore.setState({ sessionLabels: {} })
    useUIStore.setState({ uiStateInitialized: false, agentDialog: null })
  })

  it('offers to make a normal session an agent', async () => {
    const user = await openMenu()
    await user.click(await screen.findByText('Make Agent…'))
    expect(useUIStore.getState().agentDialog).toEqual({
      mode: 'make',
      sessionId: 'session-a',
      sessionName: 'Investigation',
    })
    expect(screen.queryByText('Remove Agent')).not.toBeInTheDocument()
  })

  it('offers rename and remove on the session of an agent', async () => {
    mocks.agent = agent
    const user = await openMenu()
    expect(screen.queryByText('Make Agent…')).not.toBeInTheDocument()
    await user.click(await screen.findByText('Rename Agent…'))
    expect(useUIStore.getState().agentDialog).toEqual({
      mode: 'rename',
      agentId: 'a1',
      name: 'Release manager',
    })
  })

  it('removes the agent and keeps the session', async () => {
    mocks.agent = agent
    const user = await openMenu()
    await user.click(await screen.findByText('Remove Agent'))
    expect(mocks.remove).toHaveBeenCalledWith({ agentId: 'a1' })
  })
})
