import { fireEvent, screen } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@/test/test-utils'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import { openSessionNetwork } from '@/components/chat/SessionNetworkIndicator'
import { toggleActiveSessionGraphPanel } from '@/lib/session-graph-panel'
import { chatQueryKeys } from '@/services/chat'
import type { Session, WorktreeSessions } from '@/types/chat'
import { ContextPanel } from './ContextPanel'

const mobile = vi.hoisted(() => ({ value: false }))
const session = { id: 's1', name: 'One', serves: ['g1#n1'] } as Session
const artifact = (id: string, title: string, created_at: number) => ({
  id,
  title,
  target: `/w1/tmp/${id}.html`,
  created_at,
})

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => mobile.value,
  isMobileViewport: () => mobile.value,
}))
vi.mock('@/components/file-browser/FileBrowserSidebar', () => ({
  FileBrowserSidebar: () => <div data-testid="files-content" />,
}))
vi.mock('@/components/chat/SessionNetworkTree', () => ({
  SessionNetworkTree: ({
    sessionId,
    onOpened,
  }: {
    sessionId: string
    onOpened?: () => void
  }) => (
    <button data-testid="network-content" onClick={onOpened}>
      {sessionId}
    </button>
  ),
}))
vi.mock('@/components/graphs/SessionGraphPanel', () => ({
  SessionGraphPanel: ({ session }: { session: Session }) => (
    <div data-testid="graph-content">{session.name}</div>
  ),
}))
vi.mock('@/services/projects', async importOriginal => ({
  ...(await importOriginal<object>()),
  useWorktree: () => ({ data: { id: 'w1', path: '/w1' } }),
}))
vi.mock('@/services/chat', async importOriginal => ({
  ...(await importOriginal<object>()),
  useSessions: () => ({ data: { sessions: [session] } }),
}))

const tab = (id: string) => screen.getByTestId(`context-panel-tab-${id}`)

function openSession() {
  useChatStore.setState({
    activeWorktreeId: 'w1',
    activeSessionIds: { w1: 's1' },
  })
}

describe('ContextPanel (#98)', () => {
  beforeEach(() => {
    mobile.value = false
    useUIStore.setState({
      fileBrowserVisible: true,
      contextPanelTab: 'files',
      sessionNetworkSessionId: null,
      sessionChatModalOpen: false,
    })
    useChatStore.setState({ activeWorktreeId: null, activeSessionIds: {} })
    useProjectsStore.setState({ selectedWorktreeId: null })
    session.artifacts = undefined
  })

  it('shows the file tree on the Files tab', () => {
    render(<ContextPanel />)
    expect(tab('files')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('files-content')).toBeInTheDocument()
  })

  it('switches tabs and stores the active tab', () => {
    openSession()
    render(<ContextPanel />)

    fireEvent.click(tab('network'))
    expect(useUIStore.getState().contextPanelTab).toBe('network')
    expect(screen.getByTestId('network-content')).toHaveTextContent('s1')

    fireEvent.click(tab('graph'))
    expect(useUIStore.getState().contextPanelTab).toBe('graph')
    expect(screen.getByTestId('graph-content')).toHaveTextContent('One')
  })

  it('keeps Network and Graph visible but disabled without a session', () => {
    render(<ContextPanel />)
    for (const [id, reason] of [
      ['network', 'Open a session to see its network.'],
      ['graph', 'Open a session to see its graph.'],
      ['artifacts', 'Open a session to see its artifacts.'],
    ] as const) {
      expect(tab(id)).toHaveAttribute('aria-disabled', 'true')
      expect(tab(id)).toHaveAttribute('title', reason)
      fireEvent.click(tab(id))
      expect(useUIStore.getState().contextPanelTab).toBe('files')
    }
    expect(tab('files')).not.toHaveAttribute('aria-disabled')
  })

  it('shows the reason when a stored tab has nothing to show', () => {
    useUIStore.setState({ contextPanelTab: 'graph' })
    render(<ContextPanel />)
    expect(
      screen.getByText('Open a session to see its graph.')
    ).toBeInTheDocument()
  })

  it('lists the artifacts of the session, newest first, with a count (#107)', () => {
    session.artifacts = [
      artifact('a', 'Old report', 1),
      artifact('b', 'New page', 2),
    ]
    openSession()
    render(<ContextPanel />)

    expect(screen.getByTestId('artifacts-tab-count')).toHaveTextContent('2')
    fireEvent.click(tab('artifacts'))
    expect(useUIStore.getState().contextPanelTab).toBe('artifacts')
    const items = screen.getAllByRole('listitem')
    expect(items.map(li => li.querySelector('.truncate')?.textContent)).toEqual(
      ['New page', 'Old report']
    )
  })

  it('names only the selected tab; the others show their icon (#107)', () => {
    openSession()
    render(<ContextPanel />)
    expect(tab('files')).toHaveTextContent('Files')
    expect(tab('graph').querySelector('.sr-only')).toHaveTextContent('Graph')
    expect(tab('graph')).toHaveAttribute('title', 'Graph')
    expect(screen.getByRole('tab', { name: 'Artifacts' })).toBeInTheDocument()
  })

  it('shows no count and an empty state without artifacts (#107)', () => {
    openSession()
    useUIStore.setState({ contextPanelTab: 'artifacts' })
    render(<ContextPanel />)
    expect(screen.queryByTestId('artifacts-tab-count')).toBeNull()
    expect(screen.getByText(/No artifacts yet/)).toBeInTheDocument()
  })

  it('closes from its close button', () => {
    render(<ContextPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Close side panel' }))
    expect(useUIStore.getState().fileBrowserVisible).toBe(false)
  })

  it('shows a pinned network and goes back to the current session', () => {
    openSession()
    useUIStore.setState({
      contextPanelTab: 'network',
      sessionNetworkSessionId: 'other',
    })
    render(<ContextPanel />)
    expect(screen.getByTestId('network-content')).toHaveTextContent('other')

    fireEvent.click(screen.getByRole('button', { name: 'Show this session' }))
    expect(screen.getByTestId('network-content')).toHaveTextContent('s1')
  })

  it('closes the phone drawer when the network opens a session', () => {
    mobile.value = true
    openSession()
    useUIStore.setState({ contextPanelTab: 'network' })
    render(<ContextPanel />)
    fireEvent.click(screen.getByTestId('network-content'))
    expect(useUIStore.getState().fileBrowserVisible).toBe(false)
  })
})

describe('Context panel entry points (#98)', () => {
  beforeEach(() => {
    useUIStore.setState({
      fileBrowserVisible: false,
      contextPanelTab: 'files',
      sessionNetworkSessionId: null,
      sessionChatModalOpen: false,
    })
  })

  it('"Show Session Network" opens the Network tab on that session', () => {
    useUIStore.setState({ fileBrowserVisible: true, contextPanelTab: 'graph' })
    openSessionNetwork('s9')
    const state = useUIStore.getState()
    expect(state.fileBrowserVisible).toBe(true)
    expect(state.contextPanelTab).toBe('network')
    expect(state.sessionNetworkSessionId).toBe('s9')
  })

  it('the graph toggle (⌘K, Mod+Shift+G) opens the Graph tab', () => {
    openSession()
    const queryClient = new QueryClient()
    queryClient.setQueryData<WorktreeSessions>(chatQueryKeys.sessions('w1'), {
      worktree_id: 'w1',
      sessions: [session],
      active_session_id: 's1',
      version: 2,
    })
    toggleActiveSessionGraphPanel(queryClient)
    expect(useUIStore.getState().fileBrowserVisible).toBe(true)
    expect(useUIStore.getState().contextPanelTab).toBe('graph')
  })

  it('the Files toggle opens the Files tab of an open Network panel', () => {
    useUIStore.setState({
      fileBrowserVisible: true,
      contextPanelTab: 'network',
    })
    useUIStore.getState().toggleContextPanel('files')
    expect(useUIStore.getState().fileBrowserVisible).toBe(true)
    expect(useUIStore.getState().contextPanelTab).toBe('files')
    useUIStore.getState().toggleContextPanel('files')
    expect(useUIStore.getState().fileBrowserVisible).toBe(false)
  })
})
