import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@/test/test-utils'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import { useChatStore } from '@/store/chat-store'
import { MobileProjectLayer } from './MobileProjectLayer'

vi.mock('@/components/dashboard/ProjectCanvasView', () => ({
  ProjectCanvasView: ({
    projectId,
    mobilePresentation,
    onDismiss,
  }: {
    projectId: string
    mobilePresentation?: string
    onDismiss?: () => void
  }) => (
    <div
      data-testid="canvas-stub"
      data-project={projectId}
      data-presentation={mobilePresentation}
    >
      <button type="button" onClick={onDismiss}>
        Close project
      </button>
    </div>
  ),
}))

vi.mock('@/services/projects', () => ({
  useProjects: () => ({
    data: ['p1', 'p2'].map(id => ({ id, name: id, path: `/repo/${id}` })),
  }),
}))

function openProject(projectId: string) {
  act(() => {
    useProjectsStore.getState().selectProject(projectId)
  })
}

/** What `navigateToSession` does: select the project and queue the session. */
function openSessionFromTab(projectId: string) {
  act(() => {
    useProjectsStore.getState().selectProject(projectId)
    useUIStore.getState().markWorktreeForAutoOpenSession('wt-1', 's-1')
  })
}

function setSessionOpen(open: boolean) {
  act(() => {
    useUIStore.getState().setSessionChatModalOpen(open, open ? 'wt-1' : null)
  })
}

function layer() {
  return screen.getByTestId('mobile-project-layer')
}

describe('MobileProjectLayer', () => {
  beforeEach(() => {
    useProjectsStore.setState({ selectedProjectId: null })
    useChatStore.setState({ activeWorktreeId: null, activeWorktreePath: null })
    useUIStore.setState({
      sessionChatModalOpen: false,
      sessionChatModalWorktreeId: null,
      autoOpenSessionWorktreeIds: new Set(),
      pendingAutoOpenSessionIds: {},
    })
  })

  it('renders nothing at the tab root', () => {
    render(<MobileProjectLayer animate />)
    expect(screen.queryByTestId('mobile-project-layer')).toBeNull()
  })

  describe('a project opened from a tab', () => {
    it('rises as a modal over the tabs', async () => {
      render(<MobileProjectLayer animate />)
      openProject('p1')

      const canvas = await screen.findByTestId('canvas-stub')
      expect(layer()).toHaveAttribute('data-entry', 'modal')
      expect(layer()).toHaveClass('bg-background')
      expect(layer().className).toContain('motion-safe:slide-in-from-bottom')
      expect(canvas).toHaveAttribute('data-presentation', 'modal')
    })

    it('returns to the project, not the tab, when its session closes', async () => {
      render(<MobileProjectLayer animate />)
      openProject('p1')
      await screen.findByTestId('canvas-stub')

      setSessionOpen(true)
      setSessionOpen(false)

      expect(useProjectsStore.getState().selectedProjectId).toBe('p1')
    })

    it('slides away when dismissed and unmounts once the slide ends', async () => {
      render(<MobileProjectLayer animate />)
      openProject('p1')
      await screen.findByTestId('canvas-stub')

      act(() => {
        screen.getByRole('button', { name: 'Close project' }).click()
      })

      // Kept mounted while it animates, and back at the tab root in the store.
      expect(useProjectsStore.getState().selectedProjectId).toBeNull()
      expect(layer()).toHaveAttribute('data-phase', 'exit')
      expect(layer().className).toContain('slide-out-to-bottom')

      fireEvent.animationEnd(layer())
      expect(screen.queryByTestId('mobile-project-layer')).toBeNull()
    })

    it('ignores the animation end of a child', async () => {
      render(<MobileProjectLayer animate />)
      openProject('p1')
      const canvas = await screen.findByTestId('canvas-stub')

      act(() => useProjectsStore.getState().selectProject(null))
      fireEvent.animationEnd(canvas)

      expect(layer()).toHaveAttribute('data-phase', 'exit')
    })
  })

  describe('a session opened straight from a tab', () => {
    it('lets the tab show through and hides the canvas', async () => {
      render(<MobileProjectLayer animate />)
      openSessionFromTab('p1')

      const canvas = await screen.findByTestId('canvas-stub')
      expect(layer()).toHaveAttribute('data-entry', 'push')
      expect(layer()).toHaveClass('pointer-events-none')
      expect(layer()).not.toHaveClass('bg-background')
      expect(canvas).toHaveAttribute('data-presentation', 'push')
    })

    it('goes back to the tab when the session closes', async () => {
      // The user never looked at the project, so back must not land on it.
      render(<MobileProjectLayer animate />)
      openSessionFromTab('p1')
      await screen.findByTestId('canvas-stub')

      setSessionOpen(true)
      setSessionOpen(false)

      expect(useProjectsStore.getState().selectedProjectId).toBeNull()
      // No exit slide: the session's own swipe already moved it off screen.
      expect(screen.queryByTestId('mobile-project-layer')).toBeNull()
    })

    it('does not pop when a project switch briefly closes the session', async () => {
      // Opening a session in another project remounts the canvas: the old one
      // clears `sessionChatModalOpen` on unmount before the new one opens it.
      render(<MobileProjectLayer animate />)
      openSessionFromTab('p1')
      await screen.findByTestId('canvas-stub')
      setSessionOpen(true)

      act(() => {
        useProjectsStore.getState().selectProject('p2')
        useUIStore.getState().setSessionChatModalOpen(false)
      })

      expect(useProjectsStore.getState().selectedProjectId).toBe('p2')
      expect(
        (await screen.findByTestId('canvas-stub')).getAttribute('data-project')
      ).toBe('p2')
    })
  })

  it('does not rise for the project launch restore brings back', async () => {
    // Restored before the shell has painted, so there is nothing to animate.
    useProjectsStore.setState({ selectedProjectId: 'p1' })
    render(<MobileProjectLayer animate={false} />)

    await screen.findByTestId('canvas-stub')
    expect(layer().className).not.toContain('slide-in-from-bottom')
  })

  it('does not rise again when the project switches while it is up', async () => {
    render(<MobileProjectLayer animate />)
    openProject('p1')
    await screen.findByTestId('canvas-stub')

    openProject('p2')

    expect(layer().className).not.toContain('slide-in-from-bottom')
  })

  describe('with reduced motion', () => {
    const original = window.matchMedia

    beforeEach(() => {
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))
    })

    afterEach(() => {
      window.matchMedia = original
    })

    it('unmounts at once, since no animation end would ever arrive', async () => {
      render(<MobileProjectLayer animate />)
      openProject('p1')
      await screen.findByTestId('canvas-stub')

      act(() => useProjectsStore.getState().selectProject(null))

      expect(screen.queryByTestId('mobile-project-layer')).toBeNull()
    })
  })
})
