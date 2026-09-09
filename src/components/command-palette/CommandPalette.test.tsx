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

const searchCalls: { query: string; enabled: boolean }[] = []

const searchResult = {
  truncated: false,
  hits: [
    {
      session_id: 'session-hit',
      session_name: 'Parser rewrite',
      project_id: 'project-2',
      project_name: 'Coolify',
      worktree_id: 'worktree-2',
      worktree_name: 'feat/deploy',
      worktree_path: '/projects/coolify',
      snippet: '…the parser needs a rewrite because…',
      message_id: 'message-1',
      match_count: 3,
      updated_at: 1_700_000_000_000,
    },
  ],
}

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
  MIN_SESSION_SEARCH_LEN: 3,
  useSessionMessageSearch: (query: string, enabled: boolean) => {
    searchCalls.push({ query, enabled })
    return {
      data: enabled && query.trim().length >= 3 ? searchResult : undefined,
      isFetching: false,
    }
  },
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

/** The mode tabs carry the same words as the group headings, so scope to one. */
function groupHeading(text: string): HTMLElement {
  const heading = Array.from(
    document.querySelectorAll('[cmdk-group-heading]')
  ).find(node => node.textContent === text)
  if (!heading) throw new Error(`no "${text}" group heading`)
  return heading as HTMLElement
}

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

    const projectsHeading = groupHeading('Projects')
    const connectionsHeading = groupHeading('Connections')

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

    const sessionsHeading = groupHeading('Recent Sessions')
    expect(screen.getByText('Deploy pipeline')).toBeInTheDocument()
    expect(screen.getByText('Coolify · feat/deploy')).toBeInTheDocument()

    expect(
      sessionsHeading.compareDocumentPosition(groupHeading('Projects')) &
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

    expect(groupHeading('Sessions')).toBeInTheDocument()
    expect(
      document.querySelector('[cmdk-group-heading]')?.textContent
    ).not.toBe('Recent Sessions')
    expect(screen.getByText('Deploy pipeline')).toBeInTheDocument()
  })

  it('lists the current project last, marked as current', () => {
    render(<CommandPalette />)

    // Every project is listed, so nothing looks missing...
    const current = screen.getByText('Jean')
    const other = screen.getByText('Second project')
    expect(current).toBeInTheDocument()
    expect(screen.getByText('Current')).toBeInTheDocument()

    // ...but the one you are already in sorts below the ones you might switch to.
    expect(
      other.compareDocumentPosition(current) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })
})

describe('CommandPalette search mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    searchCalls.length = 0
  })

  const typeQuery = (value: string) =>
    fireEvent.change(
      screen.getByPlaceholderText(
        /Type a command|Search sessions|Search projects|Search across/
      ),
      {
        target: { value },
      }
    )

  const hitRow = () => document.querySelector('[data-value="session-hit"]')

  const modeInput = () =>
    screen.getByPlaceholderText(
      /Type a command|Search sessions|Search projects|Search across/
    )

  const pressTab = (shiftKey = false) =>
    fireEvent.keyDown(modeInput(), { key: 'Tab', shiftKey })

  /** Tab now cycles four modes, so search is three steps from quick. */
  const goToSearchMode = () => {
    pressTab()
    pressTab()
    pressTab()
  }

  it('starts in quick mode and does not run a backend search', () => {
    render(<CommandPalette />)

    expect(screen.getByText('Recent Sessions')).toBeInTheDocument()
    expect(searchCalls.every(call => !call.enabled)).toBe(true)
  })

  it('cycles every mode with Tab and wraps back to quick', () => {
    render(<CommandPalette />)

    pressTab()
    expect(
      screen.getByPlaceholderText('Search sessions...')
    ).toBeInTheDocument()
    // Quick-mode groups are gone, so two modes never render together.
    expect(screen.queryByText('Recent Sessions')).not.toBeInTheDocument()

    pressTab()
    expect(
      screen.getByPlaceholderText('Search projects...')
    ).toBeInTheDocument()

    pressTab()
    expect(
      screen.getByPlaceholderText('Search across all session messages...')
    ).toBeInTheDocument()

    pressTab()
    expect(screen.getByText('Recent Sessions')).toBeInTheDocument()
  })

  it('cycles backwards with Shift+Tab', () => {
    render(<CommandPalette />)

    pressTab(true)
    expect(
      screen.getByPlaceholderText('Search across all session messages...')
    ).toBeInTheDocument()

    pressTab(true)
    expect(
      screen.getByPlaceholderText('Search projects...')
    ).toBeInTheDocument()
  })

  it('switches mode by clicking the chip, which is the only route on mobile', () => {
    render(<CommandPalette />)

    fireEvent.click(screen.getByText('Search messages'))

    expect(
      screen.getByPlaceholderText('Search across all session messages...')
    ).toBeInTheDocument()
  })

  it('asks for a longer query before hitting the backend', () => {
    render(<CommandPalette />)
    goToSearchMode()
    typeQuery('ab')

    expect(screen.getByText(/Type at least 3 characters/)).toBeInTheDocument()
    expect(searchCalls.every(call => call.query.trim().length < 3)).toBe(true)
  })

  it('renders a hit with its snippet, location and match count', async () => {
    render(<CommandPalette />)
    goToSearchMode()
    typeQuery('parser')

    // The query is debounced before it reaches the backend. Match on the row
    // rather than on text nodes, because highlighting splits them across marks.
    await waitFor(() => expect(hitRow()).not.toBeNull())

    const row = hitRow()
    expect(row?.textContent).toContain('Parser rewrite')
    expect(row?.textContent).toContain('the parser needs a rewrite because')
    expect(row?.textContent).toContain('Coolify · feat/deploy · 3 matches')
  })

  it('opens the session the hit belongs to', async () => {
    render(<CommandPalette />)
    goToSearchMode()
    typeQuery('parser')

    await waitFor(() => expect(hitRow()).not.toBeNull())

    const row = hitRow()
    if (!row) throw new Error('search hit row never rendered')
    fireEvent.click(row)

    expect(setCommandPaletteOpen).toHaveBeenCalledWith(false)
    expect(navigateToSession).toHaveBeenCalledWith({
      projectId: 'project-2',
      worktreeId: 'worktree-2',
      sessionId: 'session-hit',
    })
  })

  it('ignores Tab with a modifier, so app shortcuts still get through', () => {
    render(<CommandPalette />)

    fireEvent.keyDown(
      screen.getByPlaceholderText('Type a command or search...'),
      { key: 'Tab', metaKey: true }
    )

    expect(screen.getByText('Recent Sessions')).toBeInTheDocument()
  })
})

// Quick caps its lists and mixes them with commands, so a known session or
// project could be truncated away or buried under unrelated entries.
describe('CommandPalette dedicated tabs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists every session, including the one already open, and nothing else', () => {
    render(<CommandPalette />)
    fireEvent.click(screen.getByRole('button', { name: 'Sessions' }))

    expect(groupHeading('Sessions')).toBeInTheDocument()
    expect(screen.getByText('Deploy pipeline')).toBeInTheDocument()
    // Quick hides it so the top hit is somewhere new; a full list must not.
    expect(screen.getByText('Currently open session')).toBeInTheDocument()
    expect(
      Array.from(document.querySelectorAll('[cmdk-group-heading]')).map(
        node => node.textContent
      )
    ).toEqual(['Sessions'])
  })

  it('opens a session from the Sessions tab through the shared navigation', () => {
    render(<CommandPalette />)
    fireEvent.click(screen.getByRole('button', { name: 'Sessions' }))
    fireEvent.click(screen.getByText('Deploy pipeline'))

    expect(setCommandPaletteOpen).toHaveBeenCalledWith(false)
    expect(navigateToSession).toHaveBeenCalledWith({
      projectId: 'project-2',
      worktreeId: 'worktree-2',
      sessionId: 'session-recent',
    })
  })

  it('gives projects the whole window, with no commands mixed in', () => {
    render(<CommandPalette />)
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }))

    expect(
      Array.from(document.querySelectorAll('[cmdk-group-heading]')).map(
        node => node.textContent
      )
    ).toEqual(['Projects'])
    expect(screen.getByText('Jean')).toBeInTheDocument()
    expect(screen.getByText('Second project')).toBeInTheDocument()
  })

  it('names the tab in the empty state', () => {
    render(<CommandPalette />)
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }))
    fireEvent.change(screen.getByPlaceholderText('Search projects...'), {
      target: { value: 'nothing-matches-this' },
    })

    expect(
      screen.getByText('No projects match “nothing-matches-this”.')
    ).toBeInTheDocument()
  })
})

describe('CommandPalette layout and highlighting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    searchCalls.length = 0
  })

  it('anchors near the top instead of centering, so the input cannot jump', () => {
    // Vertical centering repositions the whole dialog whenever the result count
    // changes, which moves the search field under the cursor while typing.
    const { container } = render(<CommandPalette />)
    const dialog = container.ownerDocument.querySelector(
      '[data-slot="dialog-content"]'
    )

    expect(dialog?.className).toContain('translate-y-0')
    expect(dialog?.className).not.toContain('translate-y-[-50%]')
  })

  it('highlights the query inside the snippet and the session name', async () => {
    render(<CommandPalette />)
    fireEvent.click(screen.getByText('Search messages'))
    fireEvent.change(
      screen.getByPlaceholderText('Search across all session messages...'),
      { target: { value: 'parser' } }
    )

    await waitFor(() =>
      expect(document.querySelectorAll('mark').length).toBeGreaterThan(0)
    )

    const marked = Array.from(document.querySelectorAll('mark')).map(
      node => node.textContent
    )
    // Casing comes from the source text, not from what was typed.
    expect(marked).toContain('Parser')
    expect(marked).toContain('parser')
  })
})
