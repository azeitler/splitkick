import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cancelDialog,
  confirmDialog,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@/test/test-utils'
import { RemotePickerModal } from './RemotePickerModal'

const isMobileState = vi.hoisted(() => ({ value: false }))
const mocks = vi.hoisted(() => ({
  closeRemotePicker: vi.fn(),
  getGitRemotes: vi.fn(),
  removeGitRemote: vi.fn(),
}))

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => isMobileState.value,
}))

vi.mock('@/store/ui-store', () => ({
  useUIStore: () => ({
    remotePickerOpen: true,
    remotePickerRepoPath: '/repo',
    closeRemotePicker: mocks.closeRemotePicker,
  }),
  getRemotePickerCallback: () => vi.fn(),
}))

vi.mock('@/services/git-status', () => ({
  getGitRemotes: (...args: unknown[]) => mocks.getGitRemotes(...args),
  removeGitRemote: (...args: unknown[]) => mocks.removeGitRemote(...args),
}))

describe('RemotePickerModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isMobileState.value = false
    mocks.getGitRemotes.mockResolvedValue([
      { name: 'origin', url: 'git@github.com:acme/app.git' },
      { name: 'adiologydev', url: 'git@github.com:adiologydev/app.git' },
    ])
    mocks.removeGitRemote.mockResolvedValue(undefined)
  })

  it('always shows the removable remote delete button on mobile', async () => {
    isMobileState.value = true

    render(<RemotePickerModal />)

    expect(await screen.findByText('origin')).toBeInTheDocument()
    expect(screen.getByText('adiologydev')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /remove adiologydev remote/i })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /remove origin remote/i })
    ).not.toBeInTheDocument()
  })

  it('keeps unfocused remote delete buttons hidden on desktop', async () => {
    render(<RemotePickerModal />)

    await waitFor(() => {
      expect(screen.getByText('adiologydev')).toBeInTheDocument()
    })

    expect(
      screen.queryByRole('button', { name: /remove adiologydev remote/i })
    ).not.toBeInTheDocument()
  })

  async function pressBackspaceOnSecondRemote() {
    render(<RemotePickerModal />)
    await screen.findByText('adiologydev')
    const dialog = screen.getByRole('dialog', { name: 'Pick a remote' })
    fireEvent.keyDown(dialog, { key: 'ArrowDown' })
    fireEvent.keyDown(dialog, { key: 'Backspace' })
  }

  it('does not remove the remote when Backspace is cancelled', async () => {
    await pressBackspaceOnSecondRemote()

    expect(
      await screen.findByRole('alertdialog', {
        name: 'Remove git remote “adiologydev”?',
      })
    ).toBeInTheDocument()
    await cancelDialog()

    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    )
    expect(mocks.removeGitRemote).not.toHaveBeenCalled()
  })

  it('removes the remote after Backspace is confirmed', async () => {
    await pressBackspaceOnSecondRemote()

    await screen.findByRole('alertdialog', {
      name: 'Remove git remote “adiologydev”?',
    })
    expect(mocks.removeGitRemote).not.toHaveBeenCalled()
    await confirmDialog()

    await waitFor(() =>
      expect(mocks.removeGitRemote).toHaveBeenCalledWith('/repo', 'adiologydev')
    )
  })

  it('does not remove the remote when the delete button is cancelled', async () => {
    isMobileState.value = true
    render(<RemotePickerModal />)

    fireEvent.click(
      await screen.findByRole('button', { name: /remove adiologydev remote/i })
    )
    expect(
      await screen.findByRole('alertdialog', {
        name: 'Remove git remote “adiologydev”?',
      })
    ).toBeInTheDocument()
    await cancelDialog()

    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    )
    expect(mocks.removeGitRemote).not.toHaveBeenCalled()
  })

  it('removes the remote after the delete button is confirmed', async () => {
    isMobileState.value = true
    render(<RemotePickerModal />)

    fireEvent.click(
      await screen.findByRole('button', { name: /remove adiologydev remote/i })
    )
    await screen.findByRole('alertdialog', {
      name: 'Remove git remote “adiologydev”?',
    })
    expect(mocks.removeGitRemote).not.toHaveBeenCalled()
    await confirmDialog()

    await waitFor(() =>
      expect(mocks.removeGitRemote).toHaveBeenCalledWith('/repo', 'adiologydev')
    )
  })
})
