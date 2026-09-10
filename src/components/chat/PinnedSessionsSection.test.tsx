import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render } from '@/test/test-utils'
import { SidebarWidthProvider } from '@/components/layout/SidebarWidthContext'
import { useProjectsStore } from '@/store/projects-store'
import { useChatStore } from '@/store/chat-store'
import type { Session } from '@/types/chat'
import { PinnedSessionsSection } from './PinnedSessionsSection'
import type { SessionCardData } from './session-card-utils'
import type { PinnedSessionRow } from './pinned-sessions'

const renameMutate = vi.fn()
const archiveMutate = vi.fn()
const closeMutate = vi.fn()
const removalBehavior = { current: 'archive' as 'archive' | 'delete' }

vi.mock('@/services/chat', async importOriginal => ({
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  ...(await importOriginal<typeof import('@/services/chat')>()),
  useRenameSession: () => ({ mutate: renameMutate }),
  useArchiveSession: () => ({ mutate: archiveMutate }),
  useCloseSession: () => ({ mutate: closeMutate }),
}))

vi.mock('@/services/preferences', async importOriginal => ({
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  ...(await importOriginal<typeof import('@/services/preferences')>()),
  usePreferences: () => ({
    data: { removal_behavior: removalBehavior.current },
  }),
}))

function entry(
  sessionId: string,
  name: string,
  worktreeName: string,
  overrides: Partial<SessionCardData> = {}
) {
  const session = {
    id: sessionId,
    name,
    order: 0,
    created_at: 1,
    updated_at: 1,
    messages: [],
  } as Session

  const row: PinnedSessionRow = {
    sessionId,
    worktreeId: `wt-${sessionId}`,
    worktreePath: `/tmp/${worktreeName}`,
    worktreeName,
    session,
  }

  const card = {
    session,
    status: 'idle',
    automaticStatus: 'idle',
    statusOverride: null,
    label: null,
    ...overrides,
  } as SessionCardData

  return { row, card }
}

async function openRowMenu(name: string) {
  const user = userEvent.setup()
  await user.pointer({ keys: '[MouseRight]', target: screen.getByText(name) })
  return user
}

describe('PinnedSessionsSection', () => {
  beforeEach(() => {
    renameMutate.mockClear()
    archiveMutate.mockClear()
    closeMutate.mockClear()
    removalBehavior.current = 'archive'
    useProjectsStore.setState({
      projectCanvasSettings: {},
      starredSessions: [],
    })
    useChatStore.setState({ sessionLabels: {} })
  })

  it('renders nothing when no session is pinned', () => {
    const { container } = render(
      <PinnedSessionsSection
        rows={[]}
        variant="canvas"
        projectId="p-1"
        onOpen={vi.fn()}
      />
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('lists each pinned session with its owning worktree and the count', () => {
    render(
      <PinnedSessionsSection
        rows={[
          entry('s-1', 'Investigation', 'feature-a'),
          entry('s-2', 'Review', 'feature-b'),
        ]}
        variant="canvas"
        projectId="p-1"
        onOpen={vi.fn()}
      />
    )

    expect(screen.getByText('Pinned')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('Investigation')).toBeInTheDocument()
    expect(screen.getByText('feature-a')).toBeInTheDocument()
    expect(screen.getByText('Review')).toBeInTheDocument()
    expect(screen.getByText('feature-b')).toBeInTheDocument()
  })

  it('opens the clicked session with its worktree id and path', async () => {
    const onOpen = vi.fn()
    const user = userEvent.setup()

    render(
      <PinnedSessionsSection
        rows={[entry('s-1', 'Investigation', 'feature-a')]}
        variant="sidebar"
        projectId="p-1"
        onOpen={onOpen}
      />
    )

    await user.click(screen.getByText('Investigation'))

    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen.mock.calls[0]?.[0]).toMatchObject({
      sessionId: 's-1',
      worktreeId: 'wt-s-1',
      worktreePath: '/tmp/feature-a',
    })
  })

  // The pinned row and the session's row under its workspace are the same
  // session, so they must offer the same actions.
  describe('row context menu', () => {
    function renderRow() {
      render(
        <PinnedSessionsSection
          rows={[entry('s-1', 'Investigation', 'feature-a')]}
          variant="canvas"
          projectId="p-1"
          onOpen={vi.fn()}
        />
      )
    }

    it('offers the full shared session menu', async () => {
      renderRow()
      await openRowMenu('Investigation')

      for (const item of [
        'Rename',
        'Labels',
        'Status',
        'Mark as Paused',
        'Archive Session',
        'Copy Session ID',
        'Delete Session',
      ]) {
        expect(await screen.findByText(item)).toBeInTheDocument()
      }
    })

    it('unpins through the store', async () => {
      useProjectsStore.getState().pinSessionToProject('p-1', 's-1', 'wt-s-1')

      renderRow()
      const user = await openRowMenu('Investigation')
      await user.click(await screen.findByText('Unpin from Project'))

      expect(
        useProjectsStore.getState().projectCanvasSettings['p-1']?.pinnedSessions
      ).toEqual([])
    })

    // A pin is local, a star global: starring a pinned row records the row's
    // own project and worktree, and the row then carries the star.
    it('stars the row with its project and worktree', async () => {
      renderRow()
      const user = await openRowMenu('Investigation')
      await user.click(await screen.findByRole('menuitem', { name: 'Star' }))

      expect(useProjectsStore.getState().starredSessions).toEqual([
        { projectId: 'p-1', worktreeId: 'wt-s-1', sessionId: 's-1' },
      ])
      expect(await screen.findByTestId('starred-glyph')).toBeInTheDocument()
    })

    // The row's own worktree — not some worktree bound once for the section.
    // Rename starts on a short delay, so the input is awaited.
    it('renames against the row worktree', async () => {
      renderRow()
      const user = await openRowMenu('Investigation')
      await user.click(await screen.findByText('Rename'))

      const input = await screen.findByDisplayValue('Investigation')
      await user.clear(input)
      await user.type(input, 'Renamed{Enter}')

      expect(renameMutate).toHaveBeenCalledWith({
        worktreeId: 'wt-s-1',
        worktreePath: '/tmp/feature-a',
        sessionId: 's-1',
        newName: 'Renamed',
      })
    })

    it('archives against the row worktree', async () => {
      renderRow()
      const user = await openRowMenu('Investigation')
      await user.click(await screen.findByText('Archive Session'))

      expect(archiveMutate).toHaveBeenCalledWith({
        worktreeId: 'wt-s-1',
        worktreePath: '/tmp/feature-a',
        sessionId: 's-1',
      })
    })

    it('deletes for real when the removal preference says so', async () => {
      removalBehavior.current = 'delete'
      renderRow()
      const user = await openRowMenu('Investigation')
      await user.click(await screen.findByText('Delete Session'))

      expect(closeMutate).toHaveBeenCalledWith({
        worktreeId: 'wt-s-1',
        worktreePath: '/tmp/feature-a',
        sessionId: 's-1',
      })
      expect(archiveMutate).not.toHaveBeenCalled()
    })

    it('archives instead of deleting by default', async () => {
      renderRow()
      const user = await openRowMenu('Investigation')
      await user.click(await screen.findByText('Delete Session'))

      expect(closeMutate).not.toHaveBeenCalled()
      expect(archiveMutate).toHaveBeenCalledTimes(1)
    })
  })

  // The sidebar parent used to be an uppercase caption, which broke the rhythm
  // of the workspace rows it sits above.
  describe('sidebar parent row', () => {
    function renderSidebar(expanded: boolean, onToggleExpanded = vi.fn()) {
      render(
        <PinnedSessionsSection
          rows={[
            entry('s-1', 'Investigation', 'feature-a'),
            entry('s-2', 'Review', 'feature-b'),
          ]}
          variant="sidebar"
          projectId="p-1"
          expanded={expanded}
          onToggleExpanded={onToggleExpanded}
          onOpen={vi.fn()}
        />
      )
      return { onToggleExpanded }
    }

    it('is a workspace-style row with the same geometry', () => {
      renderSidebar(true)

      const row = screen.getByRole('button', { expanded: true })
      expect(row.className).toContain('py-1.5')
      expect(row.className).toContain('pr-2')
      expect(row.className).toContain('pl-7')
    })

    it('hides its sessions while collapsed and counts them instead', () => {
      renderSidebar(false)

      expect(screen.queryByText('Investigation')).toBeNull()
      expect(screen.getByTestId('collapsed-count-badge')).toHaveTextContent('2')
    })

    it('drops the count badge once the sessions are on screen', () => {
      renderSidebar(true)

      expect(screen.getByText('Investigation')).toBeInTheDocument()
      expect(screen.queryByTestId('collapsed-count-badge')).toBeNull()
    })

    it('toggles from a click and from the keyboard', async () => {
      const user = userEvent.setup()
      const { onToggleExpanded } = renderSidebar(false)

      const row = screen.getByRole('button', { expanded: false })
      await user.click(row)
      row.focus()
      await user.keyboard('{Enter}')

      expect(onToggleExpanded).toHaveBeenCalledTimes(2)
    })

    it('keeps the canvas caption unchanged', () => {
      render(
        <PinnedSessionsSection
          rows={[entry('s-1', 'Investigation', 'feature-a')]}
          variant="canvas"
          projectId="p-1"
          onOpen={vi.fn()}
        />
      )

      expect(screen.queryByRole('button', { expanded: true })).toBeNull()
      expect(screen.getByText('Investigation')).toBeInTheDocument()
    })
  })

  // Pinned sessions used to sit flush under the Pinned row, with no guide
  // line, so they did not read as the nested rows they are (#17).
  describe('sidebar session rows', () => {
    function renderSidebarRows(sidebarWidth = 250) {
      render(
        <SidebarWidthProvider value={sidebarWidth}>
          <PinnedSessionsSection
            rows={[entry('s-1', 'Investigation', 'feature-a')]}
            variant="sidebar"
            projectId="p-1"
            expanded={true}
            onToggleExpanded={vi.fn()}
            onOpen={vi.fn()}
          />
        </SidebarWidthProvider>
      )
      return screen.getByTestId('pinned-sessions-list')
    }

    it('nests under a guide line at a workspace session offset', () => {
      const list = renderSidebarRows()

      expect(list.className).toContain('border-l')
      expect(list.className).toContain('ml-9')
      const row = screen.getByText('Investigation').closest('button')
      expect(list).toContainElement(row)
      expect(row?.className).toContain('pl-5')
    })

    it('uses the narrow offset on a narrow sidebar', () => {
      const list = renderSidebarRows(180)

      expect(list.className).toContain('ml-6')
      expect(list.className).not.toContain('ml-9')
    })

    it('matches the container WorktreeItem nests its sessions in', () => {
      const worktreeItem = readFileSync(
        join(process.cwd(), 'src/components/projects/WorktreeItem.tsx'),
        'utf8'
      )
      const list = renderSidebarRows()

      // If the workspace session list changes, the pinned list must follow.
      expect(worktreeItem).toContain("'border-l border-border/40 py-0.5'")
      expect(worktreeItem).toContain("isNarrowSidebar ? 'ml-6' : 'ml-9'")
      for (const token of ['border-l', 'border-border/40', 'py-0.5', 'ml-9']) {
        expect(list.className).toContain(token)
      }
    })

    // Every row here is a pin, so marking each would be noise.
    it('does not mark its rows with a pin', () => {
      useProjectsStore.setState({
        projectCanvasSettings: {
          'p-1': {
            pinnedSessions: [{ sessionId: 's-1', worktreeId: 'wt-s-1' }],
          },
        },
      })
      renderSidebarRows()

      expect(screen.getByText('Investigation')).toBeInTheDocument()
      expect(screen.queryByTestId('pinned-glyph')).toBeNull()
    })

    it('adds no nested list on the canvas', () => {
      render(
        <PinnedSessionsSection
          rows={[entry('s-1', 'Investigation', 'feature-a')]}
          variant="canvas"
          projectId="p-1"
          onOpen={vi.fn()}
        />
      )

      expect(screen.queryByTestId('pinned-sessions-list')).toBeNull()
    })
  })

  it('shows the session label when one is set', () => {
    render(
      <PinnedSessionsSection
        rows={[
          entry('s-1', 'Investigation', 'feature-a', {
            label: { name: 'Bug', color: '#eab308' },
          }),
        ]}
        variant="canvas"
        projectId="p-1"
        onOpen={vi.fn()}
      />
    )

    expect(screen.getByText('Bug')).toBeInTheDocument()
  })
})
