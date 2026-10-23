/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { MainWindowContent } from './MainWindowContent'
import { useUIStore } from '@/store/ui-store'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { openArchivedView } from '@/lib/archived-view'

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }))

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

vi.mock('@/components/home/HomeView', () => ({
  HomeView: () => <div data-testid="home-view" />,
}))

vi.mock('@/components/archive/ArchivedModal', () => ({
  ArchivedView: () => <div data-testid="archived-view" />,
}))

vi.mock('@/components/dashboard/ProjectCanvasView', () => ({
  ProjectCanvasView: () => <div data-testid="project-canvas" />,
}))

describe('MainWindowContent Archived view', () => {
  beforeEach(() => {
    useUIStore.setState({ archivedViewOpen: false })
    useProjectsStore.getState().selectProject(null)
    useChatStore.getState().clearActiveWorktree()
  })

  it('shows Home until the Archived view opens', async () => {
    render(<MainWindowContent />)
    expect(screen.getByTestId('home-view')).toBeInTheDocument()

    act(() => openArchivedView())

    expect(await screen.findByTestId('archived-view')).toBeInTheDocument()
    expect(screen.queryByTestId('home-view')).not.toBeInTheDocument()
  })

  it('closes the Archived view when a project is selected', async () => {
    act(() => openArchivedView())
    render(<MainWindowContent />)
    expect(await screen.findByTestId('archived-view')).toBeInTheDocument()

    act(() => useProjectsStore.getState().selectProject('p-1'))

    expect(useUIStore.getState().archivedViewOpen).toBe(false)
    expect(await screen.findByTestId('project-canvas')).toBeInTheDocument()
  })
})
