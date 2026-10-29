import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionBackupProgress } from '@/services/session-backup'
import { SetupBackupDialog } from './SetupBackupDialog'

const { backup, onOpenChange } = vi.hoisted(() => ({
  backup: {
    progress: null as SessionBackupProgress | null,
    cancel: vi.fn(async () => undefined),
    run: vi.fn(async () => undefined),
  },
  onOpenChange: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(async () => '/shared'),
}))

vi.mock('@/lib/environment', () => ({ isLocalBackend: () => true }))

vi.mock('@/components/projects/DirectoryBrowser', () => ({
  DirectoryBrowser: () => null,
}))

vi.mock('@/services/preferences', () => ({
  usePatchPreferences: () => ({ mutateAsync: vi.fn(async () => undefined) }),
}))

vi.mock('@/services/session-backup', async importOriginal => ({
  ...(await importOriginal<object>()),
  cancelSessionBackup: backup.cancel,
  runSessionBackupNow: backup.run,
  estimateSessionBackup: vi.fn(async () => ({
    bytes_needed: 1024,
    files: 3,
    free_bytes: 1024 ** 3,
  })),
  getDefaultDeviceName: vi.fn(async () => 'mb14'),
  useSessionBackupProgress: () => backup.progress,
  useSessionBackupStatus: () => ({ data: undefined }),
}))

const progress = (
  phase: SessionBackupProgress['phase']
): SessionBackupProgress => ({
  phase,
  files_done: 1,
  files_total: 3,
  bytes_done: 10,
  bytes_total: 30,
  current: null,
})

describe('SetupBackupDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    backup.progress = null
  })

  const startBackup = async () => {
    const view = render(<SetupBackupDialog open onOpenChange={onOpenChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Browse' }))
    await screen.findByText(/First backup/)
    fireEvent.click(screen.getByRole('button', { name: 'Start backup' }))
    await waitFor(() => expect(backup.run).toHaveBeenCalled())
    backup.progress = progress('copying')
    view.rerender(<SetupBackupDialog open onOpenChange={onOpenChange} />)
    await screen.findByRole('progressbar')
    return view
  }

  it('cannot be closed while the first backup runs', async () => {
    await startBackup()

    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
    expect(document.querySelector('[data-blocking-dialog]')).not.toBeNull()
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: 'Escape',
    })

    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })

  it('can be closed again after Stop', async () => {
    const view = await startBackup()

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(backup.cancel).toHaveBeenCalled()

    act(() => {
      backup.progress = progress('cancelled')
    })
    view.rerender(<SetupBackupDialog open onOpenChange={onOpenChange} />)
    await screen.findByText(/Backup stopped/)
    expect(document.querySelector('[data-blocking-dialog]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
