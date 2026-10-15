import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { screen } from '@testing-library/react'
import { render } from '@/test/test-utils'
import { ImportFromJeanDialog } from './ImportFromJeanDialog'
import type { ImportSource } from '@/services/jean-import'

const mocks = vi.hoisted(() => ({
  sources: [] as ImportSource[],
  refetch: vi.fn(),
  importFromJean: vi.fn(),
  patch: vi.fn(),
}))

vi.mock('@/services/jean-import', () => ({
  useJeanImportSources: () => ({
    data: mocks.sources,
    refetch: mocks.refetch,
    isFetching: false,
  }),
  importFromJean: mocks.importFromJean,
}))

vi.mock('@/services/preferences', () => ({
  usePatchPreferences: () => ({ mutate: mocks.patch, isPending: false }),
}))

const source: ImportSource = {
  path: '/Users/me/Library/Application Support/com.jean.desktop',
  hasJeanzState: true,
  projectCount: 3,
  worktreeCount: 7,
  sessionCount: 42,
  sizeBytes: 5 * 1024 ** 2,
  lastModified: 1_790_000_000,
  running: false,
}

describe('ImportFromJeanDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sources = [source]
  })

  it('renders nothing when there is no Jean folder to import', () => {
    mocks.sources = []
    render(<ImportFromJeanDialog />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('names JeanZ when its data is present, and offers no choice', () => {
    render(<ImportFromJeanDialog />)
    expect(
      screen.getByRole('dialog', { name: 'Import from JeanZ' })
    ).toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.getByText(source.path)).toBeInTheDocument()
    expect(screen.getByText(/3 projects · 7 worktrees · 42 sessions/))
  })

  it('remembers "Start fresh"', async () => {
    const user = userEvent.setup()
    render(<ImportFromJeanDialog />)
    await user.click(screen.getByRole('button', { name: 'Start fresh' }))
    expect(mocks.patch).toHaveBeenCalledWith({
      jean_import_offer_dismissed: true,
    })
  })

  it('imports and shows the summary', async () => {
    mocks.importFromJean.mockResolvedValue({
      sourcePath: source.path,
      copiedFiles: 1200,
      copiedBytes: 4 * 1024 ** 2,
      changes: ['Web Access port 3456 → 3460 (Jean keeps 3456)'],
      legacyMcpMentions: ['magic_prompts.investigate_issue'],
    })
    const user = userEvent.setup()
    render(<ImportFromJeanDialog />)

    await user.click(screen.getByRole('button', { name: 'Import a copy' }))

    expect(mocks.importFromJean).toHaveBeenCalledWith(source.path)
    expect(
      await screen.findByRole('dialog', { name: 'Import ready' })
    ).toBeInTheDocument()
    expect(screen.getByText(/3456 → 3460/)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Restart Splitkick' })
    ).toBeInTheDocument()
  })

  it('names Jean when there is no JeanZ data', () => {
    mocks.sources = [{ ...source, hasJeanzState: false }]
    render(<ImportFromJeanDialog />)
    expect(
      screen.getByRole('dialog', { name: 'Import from Jean' })
    ).toBeInTheDocument()
  })

  it('asks to quit Jean while it runs', () => {
    mocks.sources = [{ ...source, running: true }]
    render(<ImportFromJeanDialog />)
    expect(screen.getByText(/Jean is running/)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Import a copy' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Check again' })
    ).toBeInTheDocument()
  })
})
