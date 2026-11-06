import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@/test/test-utils'
import { useUIStore } from '@/store/ui-store'
import type { Artifact, Session } from '@/types/chat'
import { SessionArtifactsTab, displayTarget } from './SessionArtifactsTab'

const mocks = vi.hoisted(() => ({
  mobile: { value: false },
  session: { id: 's1', name: 'One' } as Session,
  edit: vi.fn(async () => true),
  openArtifact: vi.fn(),
}))

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => mocks.mobile.value,
  isMobileViewport: () => mocks.mobile.value,
}))
vi.mock('@/services/projects', async importOriginal => ({
  ...(await importOriginal<object>()),
  useWorktree: () => ({ data: { id: 'w1', path: '/w1' } }),
}))
vi.mock('@/services/chat', async importOriginal => ({
  ...(await importOriginal<object>()),
  useSessions: () => ({ data: { sessions: [mocks.session] } }),
  useEditArtifacts: () => mocks.edit,
}))
vi.mock('./open-artifact', async importOriginal => ({
  ...(await importOriginal<object>()),
  openArtifact: mocks.openArtifact,
}))

const items: Artifact[] = [
  { id: 'a', title: 'Report', target: '/w1/report.html', created_at: 1_000 },
  {
    id: 'b',
    title: 'Preview',
    target: 'https://preview.example.dev',
    note: 'Deployed build',
    created_at: 3_000,
  },
]

function renderTab() {
  render(<SessionArtifactsTab worktreeId="w1" sessionId="s1" />)
}

describe('SessionArtifactsTab (#107)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mobile.value = false
    mocks.session.artifacts = items
    useUIStore.setState({ fileBrowserVisible: true })
  })

  it('shows title, note, target and when it was added', () => {
    renderTab()
    expect(screen.getByText('Deployed build')).toBeInTheDocument()
    expect(screen.getByText('https://preview.example.dev')).toBeInTheDocument()
    expect(screen.getAllByText(/ago \(/)).toHaveLength(2)
  })

  it('shows a path inside the worktree relative to it', () => {
    renderTab()
    expect(screen.getByText('report.html')).toHaveAttribute(
      'title',
      '/w1/report.html'
    )
    expect(displayTarget('/w1/out/a.png', '/w1/')).toBe('out/a.png')
    expect(displayTarget('/w10/a.png', '/w1')).toBe('/w10/a.png')
    expect(displayTarget('https://x.dev', '/w1')).toBe('https://x.dev')
  })

  it('opens an item in Splitkick, or outside with the external button', () => {
    renderTab()
    fireEvent.click(screen.getByText('Report'))
    expect(mocks.openArtifact).toHaveBeenCalledWith(items[0], '/w1', {
      system: false,
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Open Preview outside Splitkick' })
    )
    expect(mocks.openArtifact).toHaveBeenCalledWith(items[1], '/w1', {
      system: true,
    })
  })

  it('removes one artifact and clears all', () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'Remove Report' }))
    expect(mocks.edit).toHaveBeenCalledWith({ kind: 'remove', id: 'a' })
    fireEvent.click(screen.getByRole('button', { name: /Clear all/ }))
    expect(mocks.edit).toHaveBeenCalledWith({ kind: 'clear' })
  })

  it('closes the phone drawer when an item opens', () => {
    mocks.mobile.value = true
    renderTab()
    fireEvent.click(screen.getByText('Report'))
    expect(useUIStore.getState().fileBrowserVisible).toBe(false)
  })
})
