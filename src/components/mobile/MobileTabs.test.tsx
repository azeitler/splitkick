import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, within } from '@/test/test-utils'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import type { AllSessionsResponse, Session } from '@/types/chat'
import type { Project } from '@/types/projects'
import { MobileTabShell } from './MobileTabShell'

const mocks = vi.hoisted(() => ({
  sessions: { entries: [] } as AllSessionsResponse,
  navigateToSession: vi.fn(),
  navigateToProject: vi.fn(),
}))

vi.mock('@/services/chat', () => ({
  useAllSessions: () => ({ data: mocks.sessions, isLoading: false }),
}))

vi.mock('@/services/projects', () => ({
  useAppDataDir: () => ({ data: '' }),
}))

vi.mock('@/lib/navigate-to-session', () => ({
  navigateToSession: mocks.navigateToSession,
  navigateToProject: mocks.navigateToProject,
}))

// Usage has its own tests; here only its place on the Settings tab matters.
vi.mock('@/components/preferences/panes/UsagePane', async importOriginal => ({
  ...(await importOriginal<object>()),
  UsagePane: () => <div data-testid="usage-pane-stub" />,
}))

vi.mock('@/components/titlebar/UsagePopover', async importOriginal => ({
  ...(await importOriginal<object>()),
  usePeakUsage: () => null,
}))

vi.mock('@/components/dashboard/ProjectCanvasView', () => ({
  ProjectCanvasView: () => <div data-testid="canvas-stub" />,
}))

function session(id: string, extra: Partial<Session> = {}): Session {
  return {
    id,
    name: id,
    order: 0,
    created_at: 1,
    updated_at: 1,
    messages: [],
    ...extra,
  } as unknown as Session
}

function withSessions(sessions: Session[]) {
  mocks.sessions = {
    entries: [
      {
        project_id: 'p1',
        project_name: 'jean',
        worktree_id: 'wt-1',
        worktree_name: 'main',
        worktree_path: '/tmp/main',
        sessions,
      },
    ],
  }
}

const projects: Project[] = [
  { id: 'jean', name: 'jean' },
  { id: 'clients', name: 'Clients', is_folder: true },
  { id: 'acme', name: 'acme', parent_id: 'clients' },
] as unknown as Project[]

function renderShell() {
  return render(<MobileTabShell projects={projects} />)
}

describe('MobileTabShell', () => {
  beforeEach(() => {
    mocks.sessions = { entries: [] }
    mocks.navigateToSession.mockClear()
    mocks.navigateToProject.mockClear()
    useUIStore.setState({ mobileActiveTab: 'home' })
    useProjectsStore.setState({ selectedProjectId: null, starredSessions: [] })
  })

  it('shows the persisted tab', () => {
    useUIStore.setState({ mobileActiveTab: 'history' })
    renderShell()

    expect(screen.getByTestId('mobile-tab-history')).toBeInTheDocument()
    expect(screen.queryByTestId('mobile-tab-home')).toBeNull()
  })

  it('mounts only the active tab', async () => {
    const user = userEvent.setup()
    renderShell()

    await user.click(screen.getByRole('tab', { name: 'Starred' }))

    expect(screen.getByTestId('mobile-tab-starred')).toBeInTheDocument()
    expect(screen.queryByTestId('mobile-tab-home')).toBeNull()
  })

  describe('Home', () => {
    it('groups projects by folder', () => {
      renderShell()

      const list = screen.getByTestId('mobile-home-projects')
      expect(within(list).getByText('Clients')).toBeInTheDocument()
      expect(within(list).getByText('jean')).toBeInTheDocument()
      expect(within(list).getByText('acme')).toBeInTheDocument()
    })

    it('opens a project on its home page', async () => {
      const user = userEvent.setup()
      renderShell()

      await user.click(screen.getByRole('button', { name: /acme/ }))

      expect(mocks.navigateToProject).toHaveBeenCalledWith('acme')
      expect(useUIStore.getState().pendingProjectHomeId).toBe('acme')
    })

    it('offers the last opened session to continue', () => {
      withSessions([
        session('older', { last_opened_at: 100 }),
        session('latest', { last_opened_at: 900 }),
      ])
      renderShell()

      const row = screen.getByTestId('mobile-home-continue')
      expect(within(row).getByText('latest')).toBeInTheDocument()
      expect(within(row).queryByText('older')).toBeNull()
    })

    it('has no Continue row before anything was opened', () => {
      withSessions([session('never')])
      renderShell()

      expect(screen.queryByTestId('mobile-home-continue')).toBeNull()
    })

    it('lists unread sessions first, as the desktop bell does', () => {
      withSessions([
        session('finished', {
          last_run_status: 'completed',
          updated_at: 500,
          last_opened_at: 100,
        }),
        session('seen', {
          last_run_status: 'completed',
          updated_at: 500,
          last_opened_at: 900,
        }),
      ])
      renderShell()

      const list = screen.getByTestId('mobile-home-unread')
      expect(within(list).getByText('finished')).toBeInTheDocument()
      expect(within(list).queryByText('seen')).toBeNull()
    })

    it('has no Unread section when everything is seen', () => {
      renderShell()
      expect(screen.queryByTestId('mobile-home-unread')).toBeNull()
    })

    it('keeps the drawer footer actions', () => {
      renderShell()

      expect(
        screen.getByRole('button', { name: 'Add project' })
      ).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: 'Archived' })
      ).toBeInTheDocument()
    })
  })

  describe('Starred', () => {
    beforeEach(() => {
      useUIStore.setState({ mobileActiveTab: 'starred' })
    })

    it('lists stars in star order, not activity order', () => {
      // `alpha` is newer, but `bravo` was starred first.
      withSessions([
        session('alpha', { last_message_at: 900 }),
        session('bravo', { last_message_at: 100 }),
      ])
      useProjectsStore.setState({
        starredSessions: [
          { projectId: 'p1', worktreeId: 'wt-1', sessionId: 'bravo' },
          { projectId: 'p1', worktreeId: 'wt-1', sessionId: 'alpha' },
        ],
      })
      renderShell()

      const names = within(screen.getByTestId('mobile-starred-sessions'))
        .getAllByRole('button')
        .map(button => button.textContent ?? '')
      expect(names).toHaveLength(2)
      expect(names[0]).toContain('bravo')
      expect(names[1]).toContain('alpha')
    })

    it('says how to star when nothing is starred', () => {
      renderShell()
      expect(screen.getByText('No starred sessions')).toBeInTheDocument()
    })

    it('does not claim nothing is starred when stars have no session', () => {
      // Stars are never pruned; their sessions can be archived or deleted.
      useProjectsStore.setState({
        starredSessions: [
          { projectId: 'p1', worktreeId: 'wt-1', sessionId: 'gone' },
        ],
      })
      renderShell()

      expect(screen.getByText('Starred sessions not found')).toBeInTheDocument()
    })

    it('opens a starred session', async () => {
      withSessions([session('alpha')])
      useProjectsStore.setState({
        starredSessions: [
          { projectId: 'p1', worktreeId: 'wt-1', sessionId: 'alpha' },
        ],
      })
      const user = userEvent.setup()
      renderShell()

      await user.click(
        within(screen.getByTestId('mobile-starred-sessions')).getByRole(
          'button'
        )
      )

      expect(mocks.navigateToSession).toHaveBeenCalledWith({
        projectId: 'p1',
        worktreeId: 'wt-1',
        sessionId: 'alpha',
      })
    })
  })

  describe('History', () => {
    beforeEach(() => {
      useUIStore.setState({ mobileActiveTab: 'history' })
    })

    it('lists opened sessions, most recently opened first', () => {
      withSessions([
        session('first', { last_opened_at: 100 }),
        session('second', { last_opened_at: 200 }),
        session('never'),
      ])
      renderShell()

      const list = screen.getByTestId('mobile-history-sessions')
      const names = within(list)
        .getAllByRole('button')
        .map(button => button.textContent ?? '')
      expect(names[0]).toContain('second')
      expect(names[1]).toContain('first')
      expect(names).toHaveLength(2)
    })

    it('explains an empty history', () => {
      renderShell()
      expect(screen.getByText('No history yet')).toBeInTheDocument()
    })

    it('filters a long history', async () => {
      withSessions(
        Array.from({ length: 7 }, (_, i) =>
          session(`session-${i}`, { last_opened_at: 100 + i })
        )
      )
      const user = userEvent.setup()
      renderShell()

      await user.type(screen.getByLabelText('Filter history'), 'session-3')

      const list = screen.getByTestId('mobile-history-sessions')
      expect(within(list).getAllByRole('button')).toHaveLength(1)
    })
  })

  describe('Usage', () => {
    it('is plan usage only', () => {
      useUIStore.setState({ mobileActiveTab: 'usage' })
      renderShell()

      const page = screen.getByTestId('mobile-tab-usage')
      expect(within(page).getByTestId('usage-pane-stub')).toBeInTheDocument()
      // No preferences, updates or About on this tab any more.
      expect(within(page).queryByText('Appearance')).toBeNull()
      expect(within(page).queryByText('Version')).toBeNull()
    })
  })

  describe('Settings, from the Home gear', () => {
    beforeEach(() => {
      useUIStore.setState({
        mobileActiveTab: 'home',
        preferencesOpen: false,
        availableCliUpdates: [],
        pendingServerUpdate: null,
        pendingUpdateVersion: null,
        updateReadyVersion: null,
        isUpdateInstalling: false,
      })
    })

    async function openSettings() {
      const user = userEvent.setup()
      renderShell()
      await user.click(screen.getByRole('button', { name: /^Settings/ }))
      return user
    }

    it('sits top right on Home and pushes the Settings page', async () => {
      await openSettings()

      expect(screen.getByTestId('mobile-settings-page')).toBeInTheDocument()
      expect(
        screen.getByRole('heading', { name: 'Settings' })
      ).toBeInTheDocument()
    })

    it('is only on Home', () => {
      useUIStore.setState({ mobileActiveTab: 'starred' })
      renderShell()
      expect(screen.queryByTestId('mobile-home-settings')).toBeNull()
    })

    it('goes back to Home', async () => {
      const user = await openSettings()

      await user.click(
        within(screen.getByTestId('mobile-settings-page')).getByRole('button', {
          name: 'Back',
        })
      )

      expect(screen.queryByTestId('mobile-settings-page')).toBeNull()
      expect(screen.getByTestId('mobile-tab-home')).toBeInTheDocument()
    })

    it('opens the Preferences dialog on the tapped pane', async () => {
      const user = await openSettings()

      await user.click(screen.getByTestId('mobile-settings-pane-appearance'))

      expect(useUIStore.getState().preferencesOpen).toBe(true)
      expect(useUIStore.getState().preferencesPane).toBe('appearance')
    })

    it('leaves out desktop-only panes', async () => {
      await openSettings()
      expect(
        screen.queryByTestId('mobile-settings-pane-keybindings')
      ).toBeNull()
      expect(screen.queryByTestId('mobile-settings-pane-web-access')).toBeNull()
    })

    it('marks a pending update on the gear and lists it', async () => {
      useUIStore.setState({ pendingUpdateVersion: '0.2.0' })
      await openSettings()

      expect(screen.getByTestId('settings-update-dot')).toBeInTheDocument()
      expect(screen.getByTestId('mobile-settings-updates')).toHaveTextContent(
        'Update available'
      )
    })

    it('has no Updates section when nothing waits', async () => {
      await openSettings()
      expect(screen.queryByTestId('settings-update-dot')).toBeNull()
      expect(screen.queryByTestId('mobile-settings-updates')).toBeNull()
    })

    it('carries the About links the phone title bar dropped', async () => {
      await openSettings()
      expect(screen.getByText('Version')).toBeInTheDocument()
      expect(screen.getByText('GitHub')).toBeInTheDocument()
      expect(screen.getByText('Sponsor')).toBeInTheDocument()
    })
  })
})
