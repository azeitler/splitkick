import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Session } from '@/types/chat'
import { PinnedSessionsSection } from './PinnedSessionsSection'
import type { SessionCardData } from './session-card-utils'
import type { PinnedSessionRow } from './pinned-sessions'

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

describe('PinnedSessionsSection', () => {
  it('renders nothing when no session is pinned', () => {
    const { container } = render(
      <PinnedSessionsSection
        rows={[]}
        variant="canvas"
        onOpen={vi.fn()}
        onUnpin={vi.fn()}
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
        onOpen={vi.fn()}
        onUnpin={vi.fn()}
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
        onOpen={onOpen}
        onUnpin={vi.fn()}
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

  it('unpins from the row context menu', async () => {
    const onUnpin = vi.fn()
    const user = userEvent.setup()

    render(
      <PinnedSessionsSection
        rows={[entry('s-1', 'Investigation', 'feature-a')]}
        variant="canvas"
        onOpen={vi.fn()}
        onUnpin={onUnpin}
      />
    )

    await user.pointer({
      keys: '[MouseRight]',
      target: screen.getByText('Investigation'),
    })
    await user.click(await screen.findByText('Unpin from Project'))

    expect(onUnpin).toHaveBeenCalledWith('s-1')
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
          expanded={expanded}
          onToggleExpanded={onToggleExpanded}
          onOpen={vi.fn()}
          onUnpin={vi.fn()}
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
          onOpen={vi.fn()}
          onUnpin={vi.fn()}
        />
      )

      expect(screen.queryByRole('button', { expanded: true })).toBeNull()
      expect(screen.getByText('Investigation')).toBeInTheDocument()
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
        onOpen={vi.fn()}
        onUnpin={vi.fn()}
      />
    )

    expect(screen.getByText('Bug')).toBeInTheDocument()
  })
})
