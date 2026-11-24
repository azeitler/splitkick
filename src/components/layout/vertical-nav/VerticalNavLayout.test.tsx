import { act, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@/test/test-utils'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import { VerticalNavLayout } from './VerticalNavLayout'
import type * as VerticalNavModule from './VerticalNav'
import type * as EnvironmentModule from '@/lib/environment'

// The layout is under test, not its parts.
vi.mock('./VerticalNav', async importOriginal => ({
  ...(await importOriginal<typeof VerticalNavModule>()),
  VerticalNav: ({
    home,
    onSelectHome,
    onSelectTab,
  }: {
    home: boolean
    onSelectHome: () => void
    onSelectTab: (tab: 'projects') => void
  }) => (
    <nav data-testid="vertical-nav" data-home={String(home)}>
      <button onClick={onSelectHome}>Home</button>
      <button onClick={() => onSelectTab('projects')}>Projects</button>
    </nav>
  ),
}))
vi.mock('./HomeFooter', () => ({
  HomeFooter: () => <div data-testid="home-footer" />,
}))
vi.mock('@/components/sidebar/SidebarFooter', () => ({
  SidebarFooter: ({ compact }: { compact?: boolean }) => (
    <div data-testid="sidebar-footer" data-compact={String(!!compact)} />
  ),
}))
const env = vi.hoisted(() => ({ native: true }))
vi.mock('@/lib/environment', async importOriginal => ({
  ...(await importOriginal<typeof EnvironmentModule>()),
  isNativeApp: () => env.native,
}))
vi.mock('@/components/projects/ProjectsSidebar', async () => {
  const { useSidebarWidth } = await import('../SidebarWidthContext')
  return {
    // Shows the width the tab contents get, so the test can read it.
    ProjectsSidebar: () => (
      <div data-testid="projects-sidebar" data-width={useSidebarWidth()} />
    ),
  }
})
vi.mock('@/components/toolbar/WindowToolbar', () => ({
  WindowToolbar: ({
    sidebarToggle,
    trafficLightInset,
  }: {
    sidebarToggle?: boolean
    trafficLightInset?: boolean
  }) => (
    <div
      data-testid="window-toolbar"
      data-sidebar-toggle={String(sidebarToggle)}
      data-traffic-light-inset={String(trafficLightInset)}
    />
  ),
}))
vi.mock('../DevModeBanner', () => ({ DevModeBanner: () => null }))

function renderLayout() {
  return render(
    <VerticalNavLayout windowTitle="Splitkick" isInitialized>
      <div data-testid="main-content" />
    </VerticalNavLayout>
  )
}

const openProject = () =>
  act(() => {
    useProjectsStore.setState({ selectedProjectId: 'p1' })
  })

describe('VerticalNavLayout', () => {
  beforeEach(() => {
    env.native = true
    useProjectsStore.setState({ selectedProjectId: null })
    useChatStore.setState({ activeWorktreeId: null })
    useUIStore.setState({
      leftSidebarVisible: true,
      zenMode: false,
      archivedViewOpen: false,
      scheduledViewOpen: false,
      activeGraphId: null,
      verticalNavCollapsed: false,
    })
  })

  it('Home: no panel and no sidebar button; nav below the toolbar, compact footer and Home footer', async () => {
    renderLayout()
    expect(screen.getByTestId('vertical-nav-layout')).toHaveAttribute(
      'data-home',
      'true'
    )
    expect(screen.queryByTestId('sidebar-column')).toBeNull()
    expect(screen.queryByTestId('projects-sidebar')).toBeNull()
    expect(screen.getByTestId('vertical-nav')).toHaveAttribute(
      'data-home',
      'true'
    )
    const toolbar = screen.getByTestId('window-toolbar')
    expect(toolbar).toHaveAttribute('data-sidebar-toggle', 'false')
    expect(toolbar).toHaveAttribute('data-traffic-light-inset', 'true')
    expect(screen.getByTestId('sidebar-footer')).toHaveAttribute(
      'data-compact',
      'true'
    )
    expect(screen.getByTestId('home-footer')).toBeInTheDocument()
  })

  it('other tabs: sidebar column with nav, panel and full footer; sidebar button in the toolbar', async () => {
    renderLayout()
    openProject()
    expect(await screen.findByTestId('projects-sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-column')).toContainElement(
      screen.getByTestId('vertical-nav')
    )
    expect(screen.getByTestId('vertical-nav-titlebar')).toBeEmptyDOMElement()
    expect(screen.getByTestId('sidebar-footer')).toHaveAttribute(
      'data-compact',
      'false'
    )
    expect(screen.queryByTestId('home-footer')).toBeNull()
    const toolbar = screen.getByTestId('window-toolbar')
    expect(toolbar).toHaveAttribute('data-sidebar-toggle', 'true')
    expect(toolbar).toHaveAttribute('data-traffic-light-inset', 'false')
  })

  it('web access: the same layout, without the window-controls strip', async () => {
    env.native = false
    renderLayout()
    openProject()
    expect(await screen.findByTestId('projects-sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar-column')).toContainElement(
      screen.getByTestId('vertical-nav')
    )
    expect(screen.queryByTestId('vertical-nav-titlebar')).toBeNull()
  })

  it('a tab picked on Home shows its panel; Home shows Home again', async () => {
    renderLayout()
    await userEvent.click(screen.getByRole('button', { name: 'Projects' }))
    expect(await screen.findByTestId('projects-sidebar')).toBeInTheDocument()
    expect(useUIStore.getState().sidebarTab).toBe('projects')

    await userEvent.click(screen.getByRole('button', { name: 'Home' }))
    expect(screen.queryByTestId('sidebar-column')).toBeNull()
    expect(screen.getByTestId('home-footer')).toBeInTheDocument()
  })

  it('hidden sidebar: no nav, panel or footer on other tabs, but the nav on Home', () => {
    useUIStore.setState({ leftSidebarVisible: false })
    renderLayout()
    // Home shows the nav with the sidebar hidden.
    expect(screen.getByTestId('vertical-nav')).toBeInTheDocument()

    openProject()
    expect(screen.queryByTestId('vertical-nav')).toBeNull()
    expect(screen.queryByTestId('sidebar-footer')).toBeNull()
    const toolbar = screen.getByTestId('window-toolbar')
    expect(toolbar).toHaveAttribute('data-sidebar-toggle', 'true')
    expect(toolbar).toHaveAttribute('data-traffic-light-inset', 'true')
  })

  it('a tab picked with the sidebar hidden shows the sidebar', async () => {
    useUIStore.setState({ leftSidebarVisible: false })
    renderLayout()
    await userEvent.click(screen.getByRole('button', { name: 'Projects' }))
    expect(useUIStore.getState().leftSidebarVisible).toBe(true)
    expect(await screen.findByTestId('projects-sidebar')).toBeInTheDocument()
  })

  it('keeps the main content mounted across Home and tabs', async () => {
    renderLayout()
    const content = screen.getByTestId('main-content')
    openProject()
    await screen.findByTestId('projects-sidebar')
    expect(screen.getByTestId('main-content')).toBe(content)
    act(() => {
      useProjectsStore.setState({ selectedProjectId: null })
    })
    expect(screen.getByTestId('main-content')).toBe(content)
  })

  it('sizes the column as panel + expanded nav; collapsing gives the nav room to the panel', async () => {
    useUIStore.setState({ leftSidebarSize: 250 })
    renderLayout()
    openProject()
    const panel = await screen.findByTestId('projects-sidebar')
    expect(screen.getByTestId('sidebar-column')).toHaveStyle({ width: '418px' })
    expect(panel).toHaveAttribute('data-width', '250')

    act(() => {
      useUIStore.setState({ verticalNavCollapsed: true })
    })
    // The column keeps its width; the panel gets 168 - 46 = 122 px more.
    expect(screen.getByTestId('sidebar-column')).toHaveStyle({ width: '418px' })
    expect(screen.getByTestId('projects-sidebar')).toHaveAttribute(
      'data-width',
      '372'
    )
  })

  it('zen: main column only', () => {
    useUIStore.setState({ zenMode: true })
    renderLayout()
    expect(screen.queryByTestId('vertical-nav')).toBeNull()
    expect(screen.queryByTestId('sidebar-footer')).toBeNull()
  })
})
