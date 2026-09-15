import { beforeEach, describe, expect, it } from 'vitest'
import { useProjectsStore } from '@/store/projects-store'
import { useTerminalStore } from '@/store/terminal-store'
import { useUIStore } from '@/store/ui-store'
import {
  applyClientViewState,
  captureClientViewState,
} from './client-view-state-store'

describe('client view state store bridge', () => {
  beforeEach(() => {
    useProjectsStore.setState({
      expandedProjectIds: new Set(),
      expandedFolderIds: new Set(),
      expandedWorktreeIds: new Set(),
      projectAccessTimestamps: {},
      dashboardWorktreeCollapseOverrides: {},
      projectCanvasSettings: {},
      projectCanvasActiveFilters: {},
      githubDashboardFavoriteProjectIds: [],
      sidebarServerFilter: null,
    })
  })

  it('captures and restores scoped client display state', () => {
    useProjectsStore.setState({
      expandedProjectIds: new Set(['server:project']),
      expandedWorktreeIds: new Set(['server:worktree']),
      projectAccessTimestamps: { 'server:project': 123 },
      projectCanvasActiveFilters: { 'server:project': 'manual' },
      sidebarServerFilter: 'server',
    })
    useUIStore.setState({ rightSidebarVisible: true, zenMode: true })
    useTerminalStore.setState({
      terminalVisibleByWorktree: { 'server:worktree': true },
    })
    const captured = captureClientViewState()
    useProjectsStore.setState({
      expandedProjectIds: new Set(),
      expandedWorktreeIds: new Set(),
      projectCanvasActiveFilters: {},
      sidebarServerFilter: null,
    })
    useUIStore.setState({ rightSidebarVisible: false, zenMode: false })
    useTerminalStore.setState({ terminalVisibleByWorktree: {} })

    applyClientViewState(captured)

    expect(useProjectsStore.getState().expandedProjectIds).toEqual(
      new Set(['server:project'])
    )
    expect(useProjectsStore.getState().expandedWorktreeIds).toEqual(
      new Set(['server:worktree'])
    )
    expect(useProjectsStore.getState().projectCanvasActiveFilters).toEqual({
      'server:project': 'manual',
    })
    expect(useProjectsStore.getState().sidebarServerFilter).toBe('server')
    expect(useUIStore.getState().rightSidebarVisible).toBe(true)
    expect(useUIStore.getState().zenMode).toBe(true)
    expect(useTerminalStore.getState().terminalVisibleByWorktree).toEqual({
      'server:worktree': true,
    })
  })
})
