/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { WorktreeContextMenu } from './WorktreeContextMenu'
import type { useWorktreeMenuActions } from './useWorktreeMenuActions'

if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture ??= vi.fn(() => false)
  Element.prototype.setPointerCapture ??= vi.fn()
}

const actions = {
  showDeleteConfirm: false,
  setShowDeleteConfirm: vi.fn(),
  isBase: false,
  runScripts: [],
  preferences: null,
  handleRun: vi.fn(),
  handleRunCommand: vi.fn(),
  handleOpenInFinder: vi.fn(),
  handleOpenInTerminal: vi.fn(),
  handleOpenInEditor: vi.fn(),
  handleOpenInGitClient: vi.fn(),
  gitClient: null,
  handleArchiveOrClose: vi.fn(),
  handleDelete: vi.fn(),
  handleCopyLink: vi.fn(),
} as unknown as ReturnType<typeof useWorktreeMenuActions>

describe('WorktreeContextMenu rename', () => {
  it('starts the rename only after the menu has closed', async () => {
    const user = userEvent.setup()
    const onRename = vi.fn()
    render(
      <WorktreeContextMenu actions={actions} onRename={onRename}>
        <span>row</span>
      </WorktreeContextMenu>
    )

    fireEvent.contextMenu(screen.getByText('row'))
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }))

    await waitFor(() => expect(onRename).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})
