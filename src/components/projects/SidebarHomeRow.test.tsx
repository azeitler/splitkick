import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@/test/test-utils'
import { SidebarHomeRow } from './SidebarHomeRow'
import { useProjectsStore } from '@/store/projects-store'
import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'
import { SidebarWidthProvider } from '@/components/layout/SidebarWidthContext'

const mocks = vi.hoisted(() => ({ isMobile: false }))

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => mocks.isMobile,
}))

function renderRow(width = 250) {
  return render(
    <SidebarWidthProvider value={width}>
      <SidebarHomeRow />
    </SidebarWidthProvider>
  )
}

describe('SidebarHomeRow', () => {
  beforeEach(() => {
    mocks.isMobile = false
    useProjectsStore.getState().selectProject(null)
    useChatStore.getState().clearActiveWorktree()
    useUIStore.getState().setLeftSidebarVisible(true)
  })

  it('clears the project and the worktree, so Home renders', async () => {
    useProjectsStore.getState().selectProject('project-1')
    useChatStore.getState().setActiveWorktree('worktree-1', '/tmp/wt')

    renderRow()
    await userEvent.click(screen.getByTestId('sidebar-home-row'))

    expect(useProjectsStore.getState().selectedProjectId).toBeNull()
    expect(useChatStore.getState().activeWorktreeId).toBeNull()
  })

  it('marks itself as the current page only when nothing else is selected', () => {
    const { unmount } = renderRow()
    expect(screen.getByTestId('sidebar-home-row')).toHaveAttribute(
      'aria-current',
      'page'
    )
    unmount()

    useProjectsStore.getState().selectProject('project-1')
    renderRow()
    expect(screen.getByTestId('sidebar-home-row')).not.toHaveAttribute(
      'aria-current'
    )
  })

  it('is not current while a session is open', () => {
    useChatStore.getState().setActiveWorktree('worktree-1', '/tmp/wt')
    renderRow()
    expect(screen.getByTestId('sidebar-home-row')).not.toHaveAttribute(
      'aria-current'
    )
  })

  it('keeps an accessible name when the sidebar is narrow', () => {
    renderRow(120)
    expect(screen.getByRole('button', { name: 'Home' })).toBeInTheDocument()
    expect(screen.queryByText('Home', { selector: 'span:not(.sr-only)' })).toBeNull()
  })

  it('closes the drawer on mobile', async () => {
    mocks.isMobile = true
    renderRow()

    await userEvent.click(screen.getByTestId('sidebar-home-row'))
    expect(useUIStore.getState().leftSidebarVisible).toBe(false)
  })
})
