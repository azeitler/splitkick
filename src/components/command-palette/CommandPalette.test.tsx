import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandPalette } from './CommandPalette'

Element.prototype.scrollIntoView = vi.fn()

const {
  fetchRemoteServerInfo,
  markConnectionSwitch,
  navigateToSession,
  reloadApp,
  selectConnection,
  setCommandPaletteOpen,
  showToast,
  warnRemoteVersionMismatch,
} = vi.hoisted(() => ({
  fetchRemoteServerInfo: vi.fn(async () => ({
    ok: true,
    appVersion: '0.1.69',
    webBuildId: '0.1.69-test',
  })),
  markConnectionSwitch: vi.fn(),
  reloadApp: vi.fn(),
  navigateToSession: vi.fn(),
  selectConnection: vi.fn(),
  setCommandPaletteOpen: vi.fn(),
  showToast: vi.fn(),
  warnRemoteVersionMismatch: vi.fn(() => false),
}))

const remoteConnections = [
  {
    id: 'remote-1',
    name: 'Active server',
    url: 'https://active.example.com',
    token: 'active-token',
  },
  {
    id: 'remote-2',
    name: 'Build server',
    url: 'https://build.example.com',
    token: 'build-token',
  },
]

const uiState = {
  commandPaletteOpen: true,
  setCommandPaletteOpen,
  sessionChatModalWorktreeId: null,
}

vi.mock('@/store/ui-store', () => ({
  useUIStore: (selector: (state: typeof uiState) => unknown) =>
    selector(uiState),
}))

vi.mock('@/hooks/use-command-context', () => ({
  useCommandContext: () => ({ showToast }),
}))

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({ data: undefined }),
}))

vi.mock('@/services/projects', () => ({
  useProjects: () => ({
    data: [
      {
        id: 'project-1',
        name: 'Jean',
        path: '/projects/jean',
        is_folder: false,
      },
      {
        id: 'project-2',
        name: 'Second project',
        path: '/projects/second',
        is_folder: false,
      },
    ],
  }),
  useAppDataDir: () => ({ data: undefined }),
}))

const chatState = {
  sessionLabels: {},
  activeWorktreeId: 'worktree-1',
  activeSessionIds: { 'worktree-1': 'session-open' },
}

vi.mock('@/store/chat-store', () => {
  const useChatStore = (selector: (state: typeof chatState) => unknown) =>
    selector(chatState)
  useChatStore.getState = () => ({ clearActiveWorktree: vi.fn() })
  return { useChatStore }
})

vi.mock('@/lib/navigate-to-session', () => ({ navigateToSession }))

vi.mock('@/services/chat', () => ({
  useAllSessions: () => ({
    data: {
      entries: [
        {
          project_id: 'project-2',
          project_name: 'Coolify',
          worktree_id: 'worktree-2',
          worktree_path: '/projects/coolify',
          worktree_name: 'feat/deploy',
          sessions: [
            {
              id: 'session-recent',
              name: 'Deploy pipeline',
              updated_at: 300,
              messages: [],
            },
            {
              id: 'session-open',
              name: 'Currently open session',
              updated_at: 400,
              messages: [],
            },
          ],
        },
      ],
    },
  }),
}))

vi.mock('@/store/projects-store', () => ({
  useProjectsStore: (selector: (state: unknown) => unknown) =>
    selector({ projectAccessTimestamps: {}, selectedProjectId: 'project-1' }),
}))

vi.mock('@/lib/commands', () => ({
  getAllCommands: () => [],
  executeCommand: vi.fn(),
}))

vi.mock('@/lib/remote-connections', () => ({
  LOCAL_CONNECTION_ID: 'local',
  getActiveConnectionId: () => 'remote-1',
  getRemoteConnections: () => remoteConnections,
  markConnectionSwitch,
  selectConnection,
  useRemoteConnections: () => remoteConnections,
}))

vi.mock('@/lib/remote-version', () => ({
  fetchRemoteServerInfo,
  warnRemoteVersionMismatch,
}))

describe('CommandPalette connections', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchRemoteServerInfo.mockResolvedValue({
      ok: true,
      appVersion: '0.1.69',
      webBuildId: '0.1.69-test',
    })
    warnRemoteVersionMismatch.mockReturnValue(false)
  })

  it('lists localhost and inactive remote connections', () => {
    render(<CommandPalette />)

    expect(screen.getByText('Connections')).toBeInTheDocument()
    expect(screen.getByText('Localhost')).toBeInTheDocument()
    expect(screen.getByText('This device')).toBeInTheDocument()
    expect(screen.getByText('Build server')).toBeInTheDocument()
    expect(screen.getByText('https://build.example.com')).toBeInTheDocument()
    expect(screen.queryByText('Active server')).not.toBeInTheDocument()
  })

  it('lists projects before connections', () => {
    render(<CommandPalette />)

    const projectsHeading = screen.getByText('Projects')
    const connectionsHeading = screen.getByText('Connections')

    expect(
      projectsHeading.compareDocumentPosition(connectionsHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('switches connections through the existing reload flow', async () => {
    render(<CommandPalette reloadApp={reloadApp} />)

    fireEvent.click(screen.getByText('Localhost'))

    expect(setCommandPaletteOpen).toHaveBeenCalledWith(false)
    expect(markConnectionSwitch).toHaveBeenCalledOnce()
    expect(selectConnection).toHaveBeenCalledWith('local')
    expect(reloadApp).toHaveBeenCalledOnce()
    expect(fetchRemoteServerInfo).not.toHaveBeenCalled()
  })

  it('warns on version mismatch but still switches from the palette', async () => {
    fetchRemoteServerInfo.mockResolvedValueOnce({
      ok: true,
      appVersion: '0.2.0',
      webBuildId: '0.2.0-test',
    })
    warnRemoteVersionMismatch.mockReturnValueOnce(true)

    render(<CommandPalette reloadApp={reloadApp} />)

    fireEvent.click(screen.getByText('Build server'))

    await waitFor(() => {
      expect(fetchRemoteServerInfo).toHaveBeenCalledWith(
        'https://build.example.com',
        'build-token'
      )
      expect(warnRemoteVersionMismatch).toHaveBeenCalledWith('0.2.0')
      expect(selectConnection).toHaveBeenCalledWith('remote-2')
      expect(reloadApp).toHaveBeenCalledOnce()
    })
    expect(showToast).not.toHaveBeenCalled()
  })
})

describe('CommandPalette sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists recent sessions with no query, ahead of projects', () => {
    render(<CommandPalette />)

    const sessionsHeading = screen.getByText('Recent Sessions')
    expect(screen.getByText('Deploy pipeline')).toBeInTheDocument()
    expect(screen.getByText('Coolify · feat/deploy')).toBeInTheDocument()

    expect(
      sessionsHeading.compareDocumentPosition(screen.getByText('Projects')) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('hides the session that is already open', () => {
    render(<CommandPalette />)

    expect(screen.queryByText('Currently open session')).not.toBeInTheDocument()
  })

  it('opens a session in another project through the shared navigation', () => {
    render(<CommandPalette />)

    fireEvent.click(screen.getByText('Deploy pipeline'))

    expect(setCommandPaletteOpen).toHaveBeenCalledWith(false)
    expect(navigateToSession).toHaveBeenCalledWith({
      projectId: 'project-2',
      worktreeId: 'worktree-2',
      sessionId: 'session-recent',
    })
  })

  it('filters sessions by project name and renames the heading', () => {
    render(<CommandPalette />)

    fireEvent.change(
      screen.getByPlaceholderText('Type a command or search...'),
      {
        target: { value: 'coolify' },
      }
    )

    expect(screen.getByText('Sessions')).toBeInTheDocument()
    expect(screen.queryByText('Recent Sessions')).not.toBeInTheDocument()
    expect(screen.getByText('Deploy pipeline')).toBeInTheDocument()
  })

  it('keeps the current project hidden while idle but searchable once typed', () => {
    render(<CommandPalette />)

    // Hidden with no query so the first project entry is the previous project.
    expect(screen.queryByText('Jean')).not.toBeInTheDocument()

    fireEvent.change(
      screen.getByPlaceholderText('Type a command or search...'),
      { target: { value: 'jean' } }
    )

    expect(screen.getByText('Jean')).toBeInTheDocument()
  })
})
