import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@/test/test-utils'
import { useProjectsStore } from '@/store/projects-store'
import { useChatStore } from '@/store/chat-store'
import type { AllSessionsEntry, Session } from '@/types/chat'
import { SidebarStarredSection } from './SidebarStarredSection'

const mocks = vi.hoisted(() => ({
  entries: [] as AllSessionsEntry[],
  navigateToSession: vi.fn(),
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

function session(id: string, name: string, extra: Partial<Session> = {}) {
  return {
    id,
    name,
    order: 0,
    created_at: 1,
    updated_at: 1,
    messages: [],
    ...extra,
  } as Session
}

function entry(project: string, worktree: string, sessions: Session[]) {
  return {
    project_id: `id-${project}`,
    project_name: project,
    worktree_id: `id-${worktree}`,
    worktree_name: worktree,
    worktree_path: `/tmp/${worktree}`,
    sessions,
  }
}

function star(sessionId: string, project: string, worktree: string) {
  return {
    projectId: `id-${project}`,
    worktreeId: `id-${worktree}`,
    sessionId,
  }
}

describe('SidebarStarredSection', () => {
  beforeEach(() => {
    mocks.navigateToSession.mockClear()
    mocks.entries = [
      entry('Jean', 'main', [session('s-1', 'Investigation')]),
      entry('Coolify', 'feat/deploy', [
        session('s-2', 'Deploy pipeline'),
        session('s-3', 'Old one', { archived_at: 5 } as Partial<Session>),
      ]),
    ]
    useProjectsStore.setState({
      starredSessions: [],
      starredSectionCollapsed: false,
      projectCanvasSettings: {},
    })
    useChatStore.setState({ sessionLabels: {} })
  })

  it('renders nothing while nothing is starred', () => {
    const { container } = render(<SidebarStarredSection />)

    expect(container).toBeEmptyDOMElement()
  })

  it('lists stars from every project, in star order, with project and workspace', () => {
    useProjectsStore.setState({
      starredSessions: [
        star('s-2', 'Coolify', 'feat/deploy'),
        star('s-1', 'Jean', 'main'),
      ],
    })
    render(<SidebarStarredSection />)

    const rows = screen.getAllByRole('button', {
      name: /Investigation|Deploy pipeline/,
    })
    expect(rows.map(row => row.textContent)).toEqual([
      'Deploy pipelineCoolify / feat/deploy',
      'InvestigationJean / main',
    ])
  })

  // The star survives; only its row is hidden until the session comes back.
  it('hides a star whose session is archived', () => {
    useProjectsStore.setState({
      starredSessions: [star('s-3', 'Coolify', 'feat/deploy')],
    })
    const { container } = render(<SidebarStarredSection />)

    expect(container).toBeEmptyDOMElement()
    expect(useProjectsStore.getState().starredSessions).toHaveLength(1)
  })

  it('collapses to a count, and remembers it in the store', async () => {
    const user = userEvent.setup()
    useProjectsStore.setState({
      starredSessions: [
        star('s-1', 'Jean', 'main'),
        star('s-2', 'Coolify', 'feat/deploy'),
      ],
    })
    render(<SidebarStarredSection />)

    await user.click(screen.getByTestId('sidebar-starred-toggle'))

    expect(screen.queryByText('Investigation')).toBeNull()
    expect(screen.getByTestId('collapsed-count-badge')).toHaveTextContent('2')
    expect(useProjectsStore.getState().starredSectionCollapsed).toBe(true)
  })

  it('opens a star through the shared navigation', async () => {
    const user = userEvent.setup()
    useProjectsStore.setState({
      starredSessions: [star('s-2', 'Coolify', 'feat/deploy')],
    })
    render(<SidebarStarredSection />)

    await user.click(screen.getByText('Deploy pipeline'))

    expect(mocks.navigateToSession).toHaveBeenCalledWith({
      projectId: 'id-Coolify',
      worktreeId: 'id-feat/deploy',
      sessionId: 's-2',
    })
  })

  it('offers Unstar on the row menu and removes the star', async () => {
    const user = userEvent.setup()
    useProjectsStore.setState({
      starredSessions: [star('s-1', 'Jean', 'main')],
    })
    render(<SidebarStarredSection />)

    await user.pointer({
      keys: '[MouseRight]',
      target: screen.getByText('Investigation'),
    })
    await user.click(await screen.findByRole('menuitem', { name: 'Unstar' }))

    expect(useProjectsStore.getState().starredSessions).toEqual([])
  })
})
