/** @vitest-environment jsdom */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ArchivedSessionEntry, Session } from '@/types/chat'
import type { Worktree } from '@/types/projects'
import { useUIStore } from '@/store/ui-store'

// A fixed noon: the fixtures are "1 hour ago" and "5 minutes ago", which
// fall on the day before when the suite runs just after midnight.
vi.useFakeTimers({ toFake: ['Date'] })
vi.setSystemTime(new Date(2026, 10, 10, 12, 0, 0))
afterAll(() => vi.useRealTimers())

const nowSec = Math.floor(Date.now() / 1000)
const DAY = 24 * 60 * 60

const env = vi.hoisted(() => ({ native: true, mobile: false }))
const invokeMock = vi.hoisted(() => vi.fn())
const navigateMock = vi.hoisted(() => vi.fn())

const worktrees: Worktree[] = [
  {
    id: 'w-merged',
    project_id: 'p-app',
    name: 'login-fix',
    path: '/tmp/login-fix',
    branch: 'fix/login',
    created_at: 0,
    order: 0,
    archived_at: nowSec - 60 * 60,
    auto_archived_pr_url: 'https://github.com/o/r/pull/1',
  } as Worktree,
  {
    id: 'w-old',
    project_id: 'p-app',
    name: 'old-spike',
    path: '/tmp/old-spike',
    branch: 'spike/old',
    created_at: 0,
    order: 0,
    archived_at: nowSec - 90 * DAY,
  } as Worktree,
]

function entry(
  id: string,
  name: string,
  archivedAt: number,
  extra: Partial<Session> = {},
  ctx: Partial<ArchivedSessionEntry> = {}
): ArchivedSessionEntry {
  return {
    session: {
      id,
      name,
      order: 0,
      created_at: 0,
      updated_at: 0,
      messages: [],
      message_count: 4,
      backend: 'claude',
      archived_at: archivedAt,
      ...extra,
    } as Session,
    worktree_id: 'w-main',
    worktree_name: 'main',
    worktree_path: '/tmp/main',
    project_id: 'p-web',
    project_name: 'website',
    ...ctx,
  }
}

const sessions: ArchivedSessionEntry[] = [
  entry(
    's-hero',
    'Hero image',
    nowSec - 5 * 60,
    {},
    { last_message_preview: 'make the hero image wider' }
  ),
  entry('s-triage', 'Bug triage', nowSec - 20 * DAY, {
    backend: 'codex',
    message_count: 1,
  }),
  // Its worktree is archived too: restoring it restores the worktree first.
  entry(
    's-in-old',
    'Spike notes',
    nowSec - 91 * DAY,
    {},
    {
      worktree_id: 'w-old',
      worktree_name: 'old-spike',
      worktree_path: '/tmp/old-spike',
      project_id: 'p-app',
      project_name: 'app',
    }
  ),
]

vi.mock('@/lib/environment', () => ({ isNativeApp: () => env.native }))
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => env.mobile }))
vi.mock('@/lib/transport', () => ({ invoke: invokeMock }))
vi.mock('@/lib/restore-navigation', () => ({
  navigateToRestoredItem: navigateMock,
}))
vi.mock('@/lib/clipboard', () => ({
  copyToClipboard: vi.fn(() => Promise.resolve()),
}))
vi.mock('@/components/toolbar/toolbar-slots', () => ({
  ToolbarContent: () => null,
  useHasWindowToolbar: () => false,
}))
vi.mock('@/components/toolbar/ToolbarSearchField', () => ({
  ToolbarPaletteSearch: () => null,
}))
vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({ data: { removal_behavior: 'archive' } }),
}))
vi.mock('@/services/projects', () => ({
  projectsQueryKeys: {
    worktrees: (id: string) => ['projects', 'worktrees', id],
  },
  useArchivedWorktrees: () => ({ data: worktrees, isLoading: false }),
  useProjects: () => ({
    data: [
      { id: 'p-app', name: 'app' },
      { id: 'p-web', name: 'website' },
    ],
    isLoading: false,
  }),
}))
vi.mock('@/services/chat', () => ({
  MIN_SESSION_SEARCH_LEN: 3,
  chatQueryKeys: { sessions: (id: string) => ['chat', 'sessions', id] },
  useAllArchivedSessions: () => ({ data: sessions, isLoading: false }),
}))

const { ArchivedView } = await import('./ArchivedModal')

function renderView() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ArchivedView />
    </QueryClientProvider>
  )
}

const rowNames = () =>
  screen
    .getAllByTestId('archived-row')
    .map(row => row.querySelector('.font-medium')?.textContent)

const row = (name: string) => {
  const found = screen
    .getAllByTestId('archived-row')
    .find(r => r.querySelector('.font-medium')?.textContent === name)
  if (!found) throw new Error(`no row ${name}`)
  return found
}

const commands = () => invokeMock.mock.calls.map(call => call[0])

beforeEach(() => {
  env.native = true
  env.mobile = false
  invokeMock.mockReset()
  invokeMock.mockImplementation(async (command: string, args: unknown) => {
    if (command === 'unarchive_worktree') {
      const { worktreeId } = args as { worktreeId: string }
      return { id: worktreeId, path: `/tmp/${worktreeId}` }
    }
    if (command === 'restore_session_with_base') {
      return { worktree: { id: 'w-main', path: '/tmp/main' } }
    }
    if (command === 'search_session_messages') {
      return {
        hits: [{ session_id: 's-triage', snippet: '…the flaky upload test…' }],
        truncated: false,
      }
    }
    return null
  })
  navigateMock.mockReset()
  useUIStore.setState({ archivedSort: 'archived' })
})

describe('ArchivedView', () => {
  it('lists the last archived first, in time sections', () => {
    renderView()
    const headings = screen.getAllByRole('heading', { level: 2 })
    expect(headings.map(h => h.textContent?.replace(/\d+$/, ''))).toEqual([
      'Today',
      'This month',
      'Older',
    ])
    expect(rowNames()).toEqual([
      'Hero image',
      'login-fix',
      'Bug triage',
      'old-spike',
      'Spike notes',
    ])
  })

  it('shows where, backend, messages, preview, reason and the archive time', () => {
    renderView()
    const hero = row('Hero image')
    expect(hero).toHaveTextContent('website › main')
    expect(hero).toHaveTextContent('Claude')
    expect(hero).toHaveTextContent('4 messages')
    expect(hero).toHaveTextContent('make the hero image wider')
    expect(hero).toHaveTextContent(/Archived 5m ago \(.+\)/)
    expect(row('login-fix')).toHaveTextContent('PR merged')
    expect(row('login-fix')).toHaveTextContent('fix/login')
    expect(row('Bug triage')).toHaveTextContent('1 message')
  })

  it('remembers the sort choice in the UI store', async () => {
    const user = userEvent.setup()
    renderView()
    await user.selectOptions(screen.getByLabelText('Sort'), 'name')
    expect(useUIStore.getState().archivedSort).toBe('name')
    expect(screen.queryAllByRole('heading', { level: 2 })).toHaveLength(0)
    expect(rowNames()).toEqual([
      'Bug triage',
      'Hero image',
      'login-fix',
      'old-spike',
      'Spike notes',
    ])

    await user.selectOptions(screen.getByLabelText('Sort'), 'project')
    expect(
      screen
        .getAllByRole('heading', { level: 2 })
        .map(h => h.textContent?.replace(/\d+$/, ''))
    ).toEqual(['app', 'website'])
  })

  it('filters by kind, project and backend', async () => {
    const user = userEvent.setup()
    renderView()
    await user.click(screen.getByRole('radio', { name: /Worktrees/ }))
    expect(rowNames()).toEqual(['login-fix', 'old-spike'])

    await user.click(screen.getByRole('radio', { name: /All/ }))
    await user.selectOptions(screen.getByLabelText('Project'), 'p-web')
    expect(rowNames()).toEqual(['Hero image', 'Bug triage'])

    await user.selectOptions(screen.getByLabelText('Backend'), 'codex')
    expect(rowNames()).toEqual(['Bug triage'])
  })

  it('searches names and message text, and says when nothing matches', async () => {
    const user = userEvent.setup()
    renderView()
    const search = screen.getByLabelText('Search archived items')
    await user.type(search, 'flaky upload')
    // Found through the message search; the row shows the snippet.
    expect(await screen.findByText('…the flaky upload test…')).toBeVisible()
    expect(rowNames()).toEqual(['Bug triage'])
    expect(invokeMock).toHaveBeenCalledWith('search_session_messages', {
      query: 'flaky upload',
      includeArchived: true,
      limit: 500,
    })

    await user.clear(search)
    await user.type(search, 'zz')
    expect(screen.getByText(/No archived items match “zz”/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(rowNames()).toHaveLength(5)
  })

  it('restores a selection, worktrees before their sessions', async () => {
    const user = userEvent.setup()
    renderView()
    await user.click(screen.getByLabelText('Select Spike notes'))
    await user.click(screen.getByLabelText('Select old-spike'))
    const bar = screen.getByTestId('archived-selection-bar')
    expect(bar).toHaveTextContent('2 selected')
    await user.click(within(bar).getByRole('button', { name: /Restore/ }))

    await waitFor(() =>
      expect(commands()).toEqual([
        'unarchive_worktree',
        'restore_session_with_base',
      ])
    )
    // A restore without "open" does not navigate.
    expect(navigateMock).not.toHaveBeenCalled()
  })

  it('deletes a selection after a confirmation, sessions first', async () => {
    const user = userEvent.setup()
    renderView()
    await user.click(screen.getByLabelText('Select all'))
    await user.click(screen.getByRole('button', { name: /Delete…/ }))
    expect(screen.getByText('Permanently delete 5 items?')).toBeInTheDocument()
    expect(commands()).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Delete 5 items' }))

    await waitFor(() =>
      expect(commands()).toEqual([
        'delete_archived_session',
        'delete_archived_session',
        'delete_archived_session',
        'permanently_delete_worktree',
        'permanently_delete_worktree',
      ])
    )
  })

  it('restore and open navigates to the session', async () => {
    const user = userEvent.setup()
    renderView()
    await user.click(
      screen.getByRole('button', { name: 'Restore and open Hero image' })
    )
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith('w-main', '/tmp/main', 's-hero')
    )
  })

  it('moves with the arrows, Enter restores and opens, Delete asks first', async () => {
    const user = userEvent.setup()
    renderView()
    expect(screen.getByText('restore and open')).toBeInTheDocument()

    row('Hero image').focus()
    await user.keyboard('{ArrowDown}')
    expect(row('login-fix')).toHaveFocus()
    await user.keyboard(' ')
    expect(row('login-fix')).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{Delete}')
    expect(screen.getByText('Permanently delete worktree?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    row('login-fix').focus()
    await user.keyboard('{Enter}')
    await waitFor(() =>
      expect(navigateMock).toHaveBeenCalledWith(
        'w-merged',
        '/tmp/w-merged',
        undefined
      )
    )
  })

  it.each([
    ['Web Access', { native: false, mobile: false }],
    ['the phone layout', { native: true, mobile: true }],
  ])('has no keyboard hints or shortcuts in %s', async (_, state) => {
    env.native = state.native
    env.mobile = state.mobile
    const user = userEvent.setup()
    renderView()
    expect(screen.queryByText('restore and open')).not.toBeInTheDocument()
    row('Hero image').focus()
    await user.keyboard('{Enter}')
    await user.keyboard('{Delete}')
    expect(commands()).toEqual([])
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})
