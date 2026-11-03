/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { MainWindowContent } from './MainWindowContent'
import { useUIStore } from '@/store/ui-store'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { openGraphView } from '@/lib/graph-view'

// The phone layout (graph layer, #79): an open graph replaces the tab shell.
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => true }))

vi.mock('@/services/projects', () => ({
  useProjects: () => ({
    data: [{ id: 'p-1', name: 'jean', path: '/tmp/jean', is_folder: false }],
    isError: false,
    refetch: vi.fn(),
  }),
}))

vi.mock('@/hooks/useInstalledBackends', () => ({
  useInstalledBackends: () => ({ installedBackends: ['claude'] }),
}))

vi.mock('@/components/mobile/MobileTabShell', () => ({
  MobileTabShell: () => <div data-testid="mobile-tab-shell" />,
}))

vi.mock('@/components/graphs/GraphView', () => ({
  GraphView: ({ graphId }: { graphId: string }) => (
    <div data-testid="graph-view">{graphId}</div>
  ),
}))

describe('MainWindowContent graph view on the phone', () => {
  beforeEach(() => {
    useUIStore.setState({ archivedViewOpen: false, activeGraphId: null })
    useProjectsStore.getState().selectProject(null)
    useChatStore.getState().clearActiveWorktree()
  })

  it('shows the graph instead of the tabs, and the tabs again after it', async () => {
    render(<MainWindowContent />)
    expect(screen.getByTestId('mobile-tab-shell')).toBeInTheDocument()

    act(() => openGraphView('g-1'))
    expect(await screen.findByTestId('graph-view')).toHaveTextContent('g-1')
    expect(screen.queryByTestId('mobile-tab-shell')).not.toBeInTheDocument()

    act(() => useUIStore.getState().setActiveGraphId(null))
    expect(screen.getByTestId('mobile-tab-shell')).toBeInTheDocument()
    expect(screen.queryByTestId('graph-view')).not.toBeInTheDocument()
  })
})
