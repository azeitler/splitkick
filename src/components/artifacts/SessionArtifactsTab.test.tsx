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
  useArtifactSnapshotDir: () => ({ data: '/data/s1/artifacts' }),
}))
vi.mock('./ArtifactDiffModal', () => ({
  ArtifactDiffModal: (props: {
    artifact: Artifact
    initial?: { from: number; to: number }
  }) => (
    <div data-testid="diff-modal">
      {props.artifact.title} {props.initial?.from}→{props.initial?.to}
    </div>
  ),
}))
vi.mock('./open-artifact', async importOriginal => ({
  ...(await importOriginal<object>()),
  openArtifact: mocks.openArtifact,
}))

const report: Artifact = {
  id: 'a',
  title: 'Report',
  target: '/w1/report.html',
  created_at: 1_000,
}
const items: Artifact[] = [
  report,
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

  it('shows the version history and opens or compares versions (#108)', () => {
    mocks.session.artifacts = [
      {
        ...report,
        versions: [
          {
            version: 1,
            title: 'Report',
            snapshot: 's1.html',
            created_at: 1_000,
          },
          {
            version: 2,
            title: 'Report',
            change: 'Added a table',
            snapshot: 's2.html',
            created_at: 5_000,
          },
        ],
      },
    ]
    renderTab()
    expect(screen.getByText(/^Updated /)).toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: '2 versions of Report' })
    expect(toggle).toHaveTextContent('v2')
    expect(
      screen.queryByRole('list', { name: 'Versions of Report' })
    ).toBeNull()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('v2 · Added a table')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open v1 of Report' }))
    expect(useUIStore.getState().viewingFilePath).toBe(
      '/data/s1/artifacts/s1.html'
    )
    expect(useUIStore.getState().viewingFileLabel).toBe('v1 · report.html')

    fireEvent.click(
      screen.getByRole('button', { name: 'Compare v2 of Report with v1' })
    )
    expect(screen.getByTestId('diff-modal')).toHaveTextContent('Report 1→2')
  })

  it('shows no history control for an artifact with one version', () => {
    renderTab()
    expect(screen.queryByRole('button', { name: /versions of/ })).toBeNull()
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
