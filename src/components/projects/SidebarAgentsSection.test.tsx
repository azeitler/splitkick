import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@/test/test-utils'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import type { Agent } from '@/types/agents'
import type { AllSessionsEntry, Session } from '@/types/chat'
import { SidebarAgentsSection } from './SidebarAgentsSection'

const mocks = vi.hoisted(() => ({
  agents: [] as Agent[],
  entries: [] as AllSessionsEntry[],
  navigateToSession: vi.fn(),
  remove: vi.fn(),
  restart: vi.fn(),
  refetch: vi.fn(),
}))

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }))

vi.mock('@/services/agents', () => ({
  useAgents: () => ({ data: mocks.agents, refetch: mocks.refetch }),
  useAgentForSession: (sessionId: string) =>
    mocks.agents.find(a => a.sessionId === sessionId),
  useRemoveAgent: () => ({ mutate: mocks.remove }),
  useUpdateAgent: () => ({ mutate: vi.fn() }),
  useRestartAgent: () => ({ mutate: mocks.restart }),
}))

vi.mock('@/services/projects', async importOriginal => ({
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  ...(await importOriginal<typeof import('@/services/projects')>()),
  useProjects: () => ({
    data: [
      { id: 'p1', name: 'Splitkick' },
      { id: 'home', name: 'assistant', hidden: true },
    ],
  }),
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

function session(id: string, name: string) {
  return {
    id,
    name,
    order: 0,
    created_at: 1,
    updated_at: 1,
    messages: [],
  } as unknown as Session
}

function agent(extra: Partial<Agent>): Agent {
  return {
    id: 'a1',
    name: 'Release manager',
    scope: 'project',
    projectId: 'p1',
    projectName: 'Splitkick',
    roleId: null,
    worktreeId: 'w1',
    worktreePath: '/tmp/w1',
    sessionId: 's1',
    sessionName: 'release work',
    pastSessionIds: [],
    createdAt: 0,
    ...extra,
  }
}

describe('SidebarAgentsSection', () => {
  beforeEach(() => {
    mocks.navigateToSession.mockClear()
    mocks.remove.mockClear()
    mocks.restart.mockClear()
    mocks.refetch.mockClear()
    mocks.agents = []
    mocks.entries = [
      {
        project_id: 'p1',
        project_name: 'Splitkick',
        worktree_id: 'w1',
        worktree_name: 'main',
        worktree_path: '/tmp/w1',
        sessions: [session('s1', 'release work')],
      },
      {
        project_id: 'home',
        project_name: 'assistant',
        worktree_id: 'w2',
        worktree_name: 'assistant',
        worktree_path: '/tmp/assistant',
        sessions: [session('s2', 'Assistant')],
      },
    ] as AllSessionsEntry[]
    useProjectsStore.setState({
      starredSessions: [],
      projectCanvasSettings: {},
    })
    useChatStore.setState({ sessionLabels: {}, activeSessionIds: {} })
    useUIStore.setState({ agentDialog: null })
  })

  it('shows the empty state with a New agent button', async () => {
    render(<SidebarAgentsSection />)
    expect(screen.getByTestId('sidebar-agents-empty')).toHaveTextContent(
      'No agents yet'
    )
    await userEvent.click(screen.getByRole('button', { name: 'New agent' }))
    expect(useUIStore.getState().agentDialog).toEqual({ mode: 'new' })
  })

  it('groups global agents first, then by project, and opens the session', async () => {
    mocks.agents = [
      agent({}),
      agent({
        id: 'a2',
        name: 'Assistant',
        scope: 'global',
        projectId: 'home',
        projectName: 'assistant',
        worktreeId: 'w2',
        sessionId: 's2',
        sessionName: 'Assistant',
      }),
    ]
    render(<SidebarAgentsSection />)
    const headers = screen
      .getAllByTestId('sidebar-agents-group')
      .map(el => el.textContent)
    expect(headers).toEqual(['Global', 'Splitkick'])

    await userEvent.click(screen.getByText('release work'))
    expect(mocks.navigateToSession).toHaveBeenCalledWith({
      projectId: 'p1',
      worktreeId: 'w1',
      sessionId: 's1',
    })
  })

  it('shows an agent without a session, with a way to remove it', async () => {
    mocks.agents = [agent({ sessionId: null, sessionName: null })]
    render(<SidebarAgentsSection />)
    const row = screen.getByTestId('sidebar-agent-no-session')
    expect(row).toHaveTextContent('Release manager')
    expect(row).toHaveTextContent('No session')
    await userEvent.click(
      screen.getByRole('button', { name: 'Remove agent Release manager' })
    )
    expect(mocks.remove).toHaveBeenCalledWith({ agentId: 'a1' })
  })

  // The session was archived by a path that did not tell the agents (a
  // deleted worktree): the row must not stay a name without any action.
  it('asks for fresh agents when an agent points at a session that is gone', () => {
    mocks.agents = [agent({ sessionId: 'gone', sessionName: 'old' })]
    render(<SidebarAgentsSection />)
    expect(mocks.refetch).toHaveBeenCalledTimes(1)
  })

  it('does not ask again while every agent session is in the list', () => {
    mocks.agents = [agent({})]
    render(<SidebarAgentsSection />)
    expect(mocks.refetch).not.toHaveBeenCalled()
  })

  it('restarts an agent that has no session', async () => {
    mocks.agents = [agent({ sessionId: null, sessionName: null })]
    render(<SidebarAgentsSection />)
    await userEvent.click(screen.getByRole('button', { name: 'Restart' }))
    expect(mocks.restart).toHaveBeenCalledWith({ agentId: 'a1' })
  })
})
