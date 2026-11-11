import { act, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@/test/test-utils'
import { useProjectsStore } from '@/store/projects-store'
import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'
import type { AllSessionsEntry, Session } from '@/types/chat'
import { SidebarStarredSection } from './SidebarStarredSection'
import { SIDEBAR_ROW_SELECTED } from './sidebar-row-styles'

const mocks = vi.hoisted(() => ({
  entries: [] as AllSessionsEntry[],
  navigateToSession: vi.fn(),
  isNativeApp: false,
  isMobile: false,
}))

vi.mock('@/lib/environment', async importOriginal => ({
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  ...(await importOriginal<typeof import('@/lib/environment')>()),
  isNativeApp: () => mocks.isNativeApp,
}))

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => mocks.isMobile,
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
    mocks.isNativeApp = false
    mocks.isMobile = false
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
    useChatStore.setState({ sessionLabels: {}, activeSessionIds: {} })
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

  it('opens a star and reveals its row in the project tree', async () => {
    const user = userEvent.setup()
    useProjectsStore.setState({
      starredSessions: [star('s-2', 'Coolify', 'feat/deploy')],
    })
    // Run the real navigation, so the reveal request itself is checked.
    const actual = await vi.importActual<
      // eslint-disable-next-line @typescript-eslint/consistent-type-imports
      typeof import('@/lib/navigate-to-session')
    >('@/lib/navigate-to-session')
    mocks.navigateToSession.mockImplementationOnce(actual.navigateToSession)
    useUIStore.setState({ pendingSidebarRevealId: null })
    render(<SidebarStarredSection />)

    await user.click(screen.getByText('Deploy pipeline'))

    // Default options: the tree below expands and scrolls to the session.
    expect(mocks.navigateToSession).toHaveBeenCalledTimes(1)
    expect(mocks.navigateToSession).toHaveBeenCalledWith({
      projectId: 'id-Coolify',
      worktreeId: 'id-feat/deploy',
      sessionId: 's-2',
    })
    expect(useUIStore.getState().pendingSidebarRevealId).toBe('session:s-2')
    expect(
      useProjectsStore.getState().expandedWorktreeIds.has('id-feat/deploy')
    ).toBe(true)
  })

  it('marks a starred session that is also pinned', () => {
    useProjectsStore.setState({
      starredSessions: [
        star('s-1', 'Jean', 'main'),
        star('s-2', 'Coolify', 'feat/deploy'),
      ],
      projectCanvasSettings: {
        'id-Coolify': {
          pinnedSessions: [{ sessionId: 's-2', worktreeId: 'id-feat/deploy' }],
        },
      },
    })
    render(<SidebarStarredSection />)

    const glyphs = screen.getAllByTestId('pinned-glyph')
    expect(glyphs).toHaveLength(1)
    expect(
      screen.getByText('Deploy pipeline').closest('button')
    ).toContainElement(glyphs[0] ?? null)
    expect(screen.queryByTestId('starred-glyph')).toBeNull()
  })

  it('marks a starred session that is also on the To-Do list', () => {
    mocks.entries = [
      entry('Jean', 'main', [
        session('s-1', 'Investigation', { todo_at: 1_700_000_000 }),
      ]),
    ]
    useProjectsStore.setState({
      starredSessions: [star('s-1', 'Jean', 'main')],
    })
    render(<SidebarStarredSection />)

    expect(
      screen.getByText('Investigation').closest('button')
    ).toContainElement(screen.getByTestId('todo-glyph'))
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

  describe('reorder', () => {
    const order = () =>
      useProjectsStore.getState().starredSessions.map(s => s.sessionId)
    const draggable = (name: string) =>
      screen.getByText(name).closest('[draggable]') as HTMLElement

    beforeEach(() => {
      useProjectsStore.setState({
        starredSessions: [
          star('s-1', 'Jean', 'main'),
          star('s-2', 'Coolify', 'feat/deploy'),
        ],
      })
    })

    it('moves a star with Move Down in the row menu', async () => {
      const user = userEvent.setup()
      render(<SidebarStarredSection />)

      await user.pointer({
        keys: '[MouseRight]',
        target: screen.getByText('Investigation'),
      })
      // The first row cannot move up.
      expect(
        await screen.findByRole('menuitem', { name: /Move Up/ })
      ).toHaveAttribute('aria-disabled', 'true')
      await user.click(screen.getByRole('menuitem', { name: /Move Down/ }))

      expect(order()).toEqual(['s-2', 's-1'])
    })

    it('moves a focused star with Alt+Arrow in the desktop app', async () => {
      mocks.isNativeApp = true
      const user = userEvent.setup()
      render(<SidebarStarredSection />)

      screen.getByText('Deploy pipeline').closest('button')?.focus()
      await user.keyboard('{Alt>}{ArrowUp}{/Alt}')
      expect(order()).toEqual(['s-2', 's-1'])

      await user.keyboard('{Alt>}{ArrowDown}{/Alt}')
      expect(order()).toEqual(['s-1', 's-2'])
    })

    it.each([
      ['web access', { isNativeApp: false, isMobile: false }],
      ['mobile', { isNativeApp: true, isMobile: true }],
    ])(
      'in %s, keeps the menu items but drops the Alt+Arrow key and hint',
      async (_name, env) => {
        Object.assign(mocks, env)
        const user = userEvent.setup()
        render(<SidebarStarredSection />)

        screen.getByText('Deploy pipeline').closest('button')?.focus()
        await user.keyboard('{Alt>}{ArrowUp}{/Alt}')
        expect(order()).toEqual(['s-1', 's-2'])

        await user.pointer({
          keys: '[MouseRight]',
          target: screen.getByText('Deploy pipeline'),
        })
        const moveUp = await screen.findByRole('menuitem', { name: /Move Up/ })
        expect(moveUp.textContent).toBe('Move Up')
        await user.click(moveUp)
        expect(order()).toEqual(['s-2', 's-1'])
      }
    )

    it('shows the Alt+Arrow hint in the desktop app', async () => {
      mocks.isNativeApp = true
      const user = userEvent.setup()
      render(<SidebarStarredSection />)

      await user.pointer({
        keys: '[MouseRight]',
        target: screen.getByText('Deploy pipeline'),
      })
      const moveUp = await screen.findByRole('menuitem', { name: /Move Up/ })
      expect(moveUp.textContent).not.toBe('Move Up')
      expect(moveUp.textContent).toContain('↑')
    })

    it('moves a star by drag and drop, with a drop indicator', () => {
      render(<SidebarStarredSection />)
      const data = new Map<string, string>()
      const dataTransfer = {
        get types() {
          return [...data.keys()]
        },
        setData: (type: string, value: string) => data.set(type, value),
        getData: (type: string) => data.get(type) ?? '',
        effectAllowed: 'all',
        dropEffect: 'none',
      }
      // jsdom's drag events carry no clientY, so the pointer reads as the
      // lower half of the row: the drop lands below it.
      const target = draggable('Deploy pipeline')

      fireEvent.dragStart(draggable('Investigation'), { dataTransfer })
      fireEvent.dragOver(target, { dataTransfer })
      expect(screen.getByTestId('drop-indicator')).toBeInTheDocument()
      fireEvent.drop(target, { dataTransfer })

      expect(order()).toEqual(['s-2', 's-1'])
      expect(screen.queryByTestId('drop-indicator')).not.toBeInTheDocument()
    })
  })

  // The open session is marked here as it is in the tree (#92).
  describe('active row', () => {
    const row = (name: string) => screen.getByText(name).closest('button')
    const open = (worktreeId: string, sessionId: string) => {
      useProjectsStore.setState({ selectedWorktreeId: worktreeId })
      useChatStore.setState({ activeSessionIds: { [worktreeId]: sessionId } })
    }

    beforeEach(() => {
      useProjectsStore.setState({
        selectedWorktreeId: null,
        starredSessions: [
          star('s-1', 'Jean', 'main'),
          star('s-2', 'Coolify', 'feat/deploy'),
        ],
      })
    })

    it('highlights the open session with the tree selection style', () => {
      open('id-main', 's-1')
      render(<SidebarStarredSection />)

      expect(row('Investigation')).toHaveAttribute('aria-current', 'page')
      expect(row('Investigation')?.className).toContain(SIDEBAR_ROW_SELECTED)
      expect(row('Investigation')).toHaveClass('font-medium')
      expect(row('Deploy pipeline')).not.toHaveAttribute('aria-current')
      expect(row('Deploy pipeline')).not.toHaveClass('bg-foreground/10')
    })

    // The tree marks a session only in the selected workspace; so does Starred.
    it('ignores the remembered session of a workspace that is not selected', () => {
      useChatStore.setState({ activeSessionIds: { 'id-main': 's-1' } })
      render(<SidebarStarredSection />)

      expect(row('Investigation')).not.toHaveAttribute('aria-current')
    })

    it('moves the highlight when another session opens', () => {
      open('id-main', 's-1')
      render(<SidebarStarredSection />)

      act(() => open('id-feat/deploy', 's-2'))

      expect(row('Deploy pipeline')).toHaveAttribute('aria-current', 'page')
      expect(row('Investigation')).not.toHaveAttribute('aria-current')
    })

    it('highlights the open session as soon as it is starred', () => {
      useProjectsStore.setState({
        starredSessions: [star('s-2', 'Coolify', 'feat/deploy')],
      })
      open('id-main', 's-1')
      render(<SidebarStarredSection />)
      expect(screen.queryByText('Investigation')).toBeNull()

      act(() => {
        useProjectsStore.setState({
          starredSessions: [
            star('s-2', 'Coolify', 'feat/deploy'),
            star('s-1', 'Jean', 'main'),
          ],
        })
      })

      expect(row('Investigation')).toHaveAttribute('aria-current', 'page')
    })
  })
})
