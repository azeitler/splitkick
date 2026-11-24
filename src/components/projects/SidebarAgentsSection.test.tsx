import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cancelDialog, confirmDialog, render, waitFor } from '@/test/test-utils'
import { getCurrentUIState } from '@/lib/ui-state-snapshot'
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
  unarchive: vi.fn(),
  native: false,
}))

vi.mock('@/lib/environment', async importOriginal => ({
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  ...(await importOriginal<typeof import('@/lib/environment')>()),
  isNativeApp: () => mocks.native,
}))

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => false,
  isMobileViewport: () => false,
}))

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
  useIsSessionLinked: () => false,
  useRenameSession: () => ({ mutate: vi.fn() }),
  useArchiveSession: () => ({ mutate: vi.fn() }),
  useCloseSession: () => ({ mutate: vi.fn() }),
  useUnarchiveSession: () => ({
    mutateAsync: mocks.unarchive,
    isPending: false,
  }),
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

/** Add sessions to the first workspace (`w1`, project `p1`). */
function addSessions(...sessions: Session[]) {
  mocks.entries[0]?.sessions.push(...sessions)
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
    mocks.unarchive.mockReset()
    mocks.native = false
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
      // Agent rows start closed; most tests look inside the sample agents.
      expandedAgentIds: new Set(['a1', 'a2']),
      collapsedAgentNodeKeys: new Set(),
      expandedAgentPreviousIds: new Set(),
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

    // The agent row is the current session: its click opens the session.
    await userEvent.click(screen.getByText('Release manager'))
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
    expect(
      await screen.findByText('Remove agent “Release manager”?')
    ).toBeInTheDocument()
    await confirmDialog()
    await waitFor(() =>
      expect(mocks.remove).toHaveBeenCalledWith({ agentId: 'a1' })
    )
  })

  it('keeps the agent when the remove confirmation is cancelled', async () => {
    mocks.agents = [agent({ sessionId: null, sessionName: null })]
    render(<SidebarAgentsSection />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Remove agent Release manager' })
    )
    await cancelDialog()
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    )
    expect(mocks.remove).not.toHaveBeenCalled()
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

  describe('agent row', () => {
    it('is the current session row: agent name, no "current" child row', () => {
      mocks.agents = [agent({})]
      render(<SidebarAgentsSection />)
      const row = screen.getByTestId('sidebar-agent')
      expect(row).toHaveTextContent('Release manager')
      expect(row).not.toHaveTextContent('current')
      // The session row is the agent row; no list below it.
      expect(screen.queryByText('release work')).toBeNull()
      expect(screen.queryByTestId('sidebar-agent-sessions')).toBeNull()
    })

    it('has no chevron without children or previous sessions', () => {
      mocks.agents = [agent({})]
      render(<SidebarAgentsSection />)
      expect(screen.queryByTestId('sidebar-agent-toggle')).toBeNull()
    })

    it('opens and closes only through the chevron, not the row', async () => {
      addSessions({
        ...session('c1', 'child one'),
        started_by_session_id: 's1',
      } as Session)
      mocks.agents = [agent({})]
      render(<SidebarAgentsSection />)

      await userEvent.click(screen.getByText('Release manager'))
      expect(screen.getByText('child one')).toBeInTheDocument()
      expect(mocks.navigateToSession).toHaveBeenCalledTimes(1)

      await userEvent.click(screen.getByTestId('sidebar-agent-toggle'))
      expect(screen.queryByText('child one')).toBeNull()
      expect(mocks.navigateToSession).toHaveBeenCalledTimes(1)
    })

    it('puts the toggle right after the name, inside the row', () => {
      addSessions({
        ...session('c1', 'child one'),
        started_by_session_id: 's1',
      } as Session)
      mocks.agents = [agent({})]
      render(<SidebarAgentsSection />)

      const toggle = screen.getByTestId('sidebar-agent-toggle')
      const name = screen.getByText('Release manager')
      // Same place as the project tree: the next element after the name.
      expect(name.nextElementSibling).toBe(toggle)
      expect(toggle).toHaveAttribute('role', 'button')
      expect(toggle.tagName).toBe('SPAN')
    })

    it('shows the status of the current session', () => {
      const entry = mocks.entries[0]
      if (entry) {
        entry.sessions = [
          {
            ...session('s1', 'release work'),
            last_run_status: 'running',
            last_run_execution_mode: 'yolo',
          } as Session,
        ]
      }
      mocks.agents = [agent({})]
      render(<SidebarAgentsSection />)
      const row = screen.getByTestId('sidebar-agent')
      // The dot of the current session's run, as on every session row.
      expect(within(row).getByLabelText('Yoloing')).toBeInTheDocument()
    })

    it('opens the full session menu with the agent items on right-click', async () => {
      mocks.agents = [agent({})]
      render(<SidebarAgentsSection />)
      fireEvent.contextMenu(screen.getByText('Release manager'))
      for (const name of [
        'Rename Agent…',
        'Restart Agent',
        'Remove Agent',
        'New Schedule…',
      ]) {
        expect(
          await screen.findByRole('menuitem', { name: new RegExp(name) })
        ).toBeInTheDocument()
      }
      // The session part of the menu is there too.
      expect(
        screen.getByRole('menuitem', { name: /Archive/ })
      ).toBeInTheDocument()
    })

    it('gives child rows the normal session menu, without agent items', async () => {
      addSessions({
        ...session('c1', 'child one'),
        started_by_session_id: 's1',
      } as Session)
      mocks.agents = [agent({})]
      render(<SidebarAgentsSection />)
      fireEvent.contextMenu(screen.getByText('child one'))
      expect(
        await screen.findByRole('menuitem', { name: /Make Agent…/ })
      ).toBeInTheDocument()
      expect(
        screen.queryByRole('menuitem', { name: /Restart Agent/ })
      ).toBeNull()
    })
  })

  describe('children and previous sessions', () => {
    function pastAndChildren() {
      addSessions(
        {
          ...session('c1', 'child one'),
          started_by_session_id: 's1',
          updated_at: 20,
        } as Session,
        {
          ...session('c2', 'child two'),
          started_by_session_id: 's1',
          updated_at: 10,
        } as Session,
        {
          ...session('g1', 'grandchild'),
          started_by_session_id: 'c1',
        } as Session,
        { ...session('old1', 'first run'), updated_at: 5 } as Session,
        { ...session('old2', 'second run'), updated_at: 8 } as Session,
        {
          ...session('oldc', 'child of old'),
          started_by_session_id: 'old2',
        } as Session,
        {
          ...session('old0', 'archived run'),
          archived_at: 3,
        } as Session
      )
      mocks.agents = [
        agent({ pastSessionIds: ['old2', 'old1', 'old0', 'deleted'] }),
      ]
    }

    it('lists the children first, newest first, then a closed Previous Sessions group', () => {
      pastAndChildren()
      render(<SidebarAgentsSection />)
      const list = screen.getByTestId('sidebar-agent-sessions')
      const text = list.textContent ?? ''
      expect(text.indexOf('child one')).toBeLessThan(text.indexOf('child two'))
      expect(text.indexOf('child two')).toBeLessThan(
        text.indexOf('Previous Sessions')
      )
      // Closed by default: a count of every previous session, archived too.
      expect(
        screen.getByTestId('sidebar-agent-previous-toggle')
      ).toHaveAttribute('aria-expanded', 'false')
      expect(
        screen.getByTestId('sidebar-agent-previous-toggle')
      ).toHaveTextContent('3')
      expect(screen.queryByText('first run')).toBeNull()
    })

    it('opens Previous Sessions: newest first, archived last, children counted', async () => {
      pastAndChildren()
      render(<SidebarAgentsSection />)
      await userEvent.click(screen.getByTestId('sidebar-agent-previous-toggle'))
      const previous = screen.getByTestId('sidebar-agent-previous-list')
      const text = previous.textContent ?? ''
      expect(text.indexOf('second run')).toBeLessThan(text.indexOf('first run'))
      expect(text.indexOf('first run')).toBeLessThan(
        text.indexOf('archived run')
      )
      expect(previous).toHaveTextContent('1 child')
      expect(screen.queryByText('child of old')).toBeNull()
      expect(screen.queryByText('deleted')).toBeNull()
      expect(
        useProjectsStore.getState().expandedAgentPreviousIds.has('a1')
      ).toBe(true)
      expect(getCurrentUIState().expanded_agent_previous_ids).toEqual(['a1'])
    })

    it('opens a previous session', async () => {
      pastAndChildren()
      useProjectsStore.setState({ expandedAgentPreviousIds: new Set(['a1']) })
      render(<SidebarAgentsSection />)
      await userEvent.click(screen.getByText('first run'))
      expect(mocks.navigateToSession).toHaveBeenCalledWith({
        projectId: 'p1',
        worktreeId: 'w1',
        sessionId: 'old1',
      })
    })

    it('restores an archived previous session before it opens it', async () => {
      pastAndChildren()
      useProjectsStore.setState({ expandedAgentPreviousIds: new Set(['a1']) })
      mocks.unarchive.mockResolvedValue({})
      render(<SidebarAgentsSection />)
      await userEvent.click(
        screen.getByTestId('sidebar-agent-archived-session')
      )
      expect(mocks.unarchive).toHaveBeenCalledWith({
        worktreeId: 'w1',
        worktreePath: '/tmp/w1',
        sessionId: 'old0',
      })
      expect(mocks.navigateToSession).toHaveBeenCalledWith({
        projectId: 'p1',
        worktreeId: 'w1',
        sessionId: 'old0',
      })
    })

    it('counts children, grandchildren and previous sessions on a closed agent', async () => {
      pastAndChildren()
      render(<SidebarAgentsSection />)
      await userEvent.click(screen.getByTestId('sidebar-agent-toggle'))
      expect(screen.queryByTestId('sidebar-agent-sessions')).toBeNull()
      // c1, c2, g1 + old2, old1, old0
      expect(screen.getByTestId('sidebar-agent-toggle')).toHaveTextContent('6')
      expect(getCurrentUIState().expanded_agent_ids).toEqual(['a2'])
    })

    it('nests the children of a child and closes that level on its own', async () => {
      pastAndChildren()
      render(<SidebarAgentsSection />)
      expect(screen.getByText('grandchild')).toBeInTheDocument()
      const toggles = screen.getAllByTestId('sidebar-agent-node-toggle')
      expect(toggles).toHaveLength(1)
      await userEvent.click(toggles[0] as HTMLElement)
      expect(screen.queryByText('grandchild')).toBeNull()
      expect(screen.getByText('child two')).toBeInTheDocument()
      expect(getCurrentUIState().collapsed_agent_node_keys).toEqual(['a1:c1'])
    })

    it('keeps previous sessions reachable when the agent has no session', async () => {
      pastAndChildren()
      mocks.agents = [
        agent({ sessionId: null, sessionName: null, pastSessionIds: ['old1'] }),
      ]
      render(<SidebarAgentsSection />)
      expect(screen.getByTestId('sidebar-agent-no-session')).toHaveTextContent(
        'No session'
      )
      await userEvent.click(screen.getByTestId('sidebar-agent-previous-toggle'))
      expect(screen.getByText('first run')).toBeInTheDocument()
    })

    it('does not loop on a session link cycle', () => {
      addSessions(
        {
          ...session('c1', 'child one'),
          started_by_session_id: 's1',
        } as Session,
        {
          ...session('c2', 'child two'),
          started_by_session_id: 'c1',
        } as Session
      )
      const entry = mocks.entries[0]
      if (entry) {
        entry.sessions = entry.sessions.map(s =>
          s.id === 's1' ? ({ ...s, started_by_session_id: 'c2' } as Session) : s
        )
      }
      mocks.agents = [agent({})]
      render(<SidebarAgentsSection />)
      expect(screen.getByText('child two')).toBeInTheDocument()
      expect(screen.getAllByText('Release manager')).toHaveLength(1)
    })

    it('collapses and expands everything from the header', async () => {
      pastAndChildren()
      render(<SidebarAgentsSection />)
      await userEvent.click(
        screen.getByRole('button', { name: 'Collapse all' })
      )
      let state = useProjectsStore.getState()
      expect(state.expandedAgentIds.size).toBe(0)
      expect([...state.collapsedAgentNodeKeys]).toEqual(['a1:c1'])
      expect(screen.queryByText('child one')).toBeNull()

      await userEvent.click(screen.getByRole('button', { name: 'Expand all' }))
      state = useProjectsStore.getState()
      expect([...state.expandedAgentIds]).toEqual(['a1'])
      expect([...state.expandedAgentPreviousIds]).toEqual(['a1'])
      expect(screen.getByText('grandchild')).toBeInTheDocument()
      expect(screen.getByText('first run')).toBeInTheDocument()
    })

    it('Left and Right close and open a focused agent row in the desktop app', async () => {
      mocks.native = true
      pastAndChildren()
      render(<SidebarAgentsSection />)
      screen.getByText('Release manager').closest('button')?.focus()
      await userEvent.keyboard('{ArrowLeft}')
      expect(screen.queryByText('child one')).toBeNull()
      await userEvent.keyboard('{ArrowRight}')
      expect(screen.getByText('child one')).toBeInTheDocument()

      screen.getByTestId('sidebar-agent-previous-toggle').focus()
      await userEvent.keyboard('{ArrowRight}')
      expect(screen.getByText('first run')).toBeInTheDocument()
    })

    it('ignores Left and Right outside the desktop app', async () => {
      pastAndChildren()
      render(<SidebarAgentsSection />)
      screen.getByText('Release manager').closest('button')?.focus()
      await userEvent.keyboard('{ArrowLeft}')
      expect(screen.getByText('child one')).toBeInTheDocument()
    })
  })

  describe('default', () => {
    beforeEach(() => {
      useProjectsStore.setState({ expandedAgentIds: new Set() })
    })

    it('starts every agent closed, with the count of its hidden sessions', () => {
      addSessions(
        {
          ...session('c1', 'child one'),
          started_by_session_id: 's1',
        } as Session,
        session('old1', 'first run')
      )
      mocks.agents = [
        agent({ pastSessionIds: ['old1'] }),
        agent({
          id: 'a3',
          name: 'New agent',
          sessionId: null,
          sessionName: null,
          pastSessionIds: ['old1'],
        }),
      ]
      render(<SidebarAgentsSection />)
      expect(screen.queryByTestId('sidebar-agent-sessions')).toBeNull()
      expect(screen.queryByText('child one')).toBeNull()
      // c1 + old1 behind the closed agent row.
      expect(screen.getByTestId('sidebar-agent')).toHaveTextContent('2')
      expect(
        screen.getByRole('button', {
          name: /Show the sessions of Release manager/,
        })
      ).toHaveAttribute('aria-expanded', 'false')
      expect(
        screen.getByRole('button', { name: 'Expand all' })
      ).toBeInTheDocument()
    })

    it('remembers an agent the user opens', async () => {
      addSessions({
        ...session('c1', 'child one'),
        started_by_session_id: 's1',
      } as Session)
      mocks.agents = [agent({})]
      render(<SidebarAgentsSection />)
      await userEvent.click(screen.getByTestId('sidebar-agent-toggle'))
      expect(screen.getByText('child one')).toBeInTheDocument()
      expect(getCurrentUIState().expanded_agent_ids).toEqual(['a1'])
    })

    it('opens an agent restored as expanded', () => {
      addSessions({
        ...session('c1', 'child one'),
        started_by_session_id: 's1',
      } as Session)
      useProjectsStore.setState({ expandedAgentIds: new Set(['a1']) })
      mocks.agents = [agent({})]
      render(<SidebarAgentsSection />)
      expect(screen.getByText('child one')).toBeInTheDocument()
    })
  })
})
