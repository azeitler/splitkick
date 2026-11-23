import { createElement, Fragment } from 'react'
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  act,
  cancelDialog,
  confirmDialog,
  render,
  screen,
  waitFor,
} from '@/test/test-utils'
import { defaultPreferences } from '@/types/preferences'
import type { CommandContext } from './types'
import { maintenanceCommands } from './maintenance-commands'

const invokeMock = vi.fn()

vi.mock('@/lib/transport', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}))

vi.mock('sonner', () => ({
  toast: {
    loading: vi.fn(() => 'toast'),
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}))

const command = maintenanceCommands.find(
  cmd => cmd.id === 'maintenance.cleanup-orphaned-sessions'
)

function makeContext(retentionDays: number) {
  const queryClient = new QueryClient()
  queryClient.setQueryData(['preferences'], {
    ...defaultPreferences,
    archive_retention_days: retentionDays,
  })
  return { queryClient } as unknown as CommandContext
}

function runCommand(retentionDays = 0) {
  // test-utils mounts <ConfirmDialogHost /> next to the rendered element.
  render(createElement(Fragment))
  let done: void | Promise<void> = undefined
  act(() => {
    done = command?.execute(makeContext(retentionDays))
  })
  return done
}

describe('Clean Up Orphaned Session Data command', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'cleanup_old_archives')
        return Promise.resolve({
          deleted_worktrees: 0,
          deleted_sessions: 0,
          deleted_contexts: 0,
        })
      if (cmd === 'cleanup_combined_contexts') return Promise.resolve(0)
      return Promise.resolve(null)
    })
  })

  it('exists', () => {
    expect(command).toBeDefined()
  })

  it('does not clean up when the dialog is cancelled', async () => {
    const done = runCommand()
    expect(
      await screen.findByText('Clean up orphaned session data?')
    ).toBeInTheDocument()

    await cancelDialog()
    await done

    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('cleans up after confirming', async () => {
    const done = runCommand()
    await screen.findByText('Clean up orphaned session data?')

    await confirmDialog()
    await done

    expect(invokeMock).toHaveBeenCalledWith('cleanup_old_archives', {
      retentionDays: 0,
    })
    expect(invokeMock).toHaveBeenCalledWith('cleanup_combined_contexts')
  })

  it('names the retention days in the dialog when a retention is set', async () => {
    const done = runCommand(30)

    expect(
      await screen.findByText(
        /archived worktrees and sessions older than 30 days/
      )
    ).toBeInTheDocument()

    await confirmDialog()
    await done
    expect(invokeMock).toHaveBeenCalledWith('cleanup_old_archives', {
      retentionDays: 30,
    })
  })

  it('leaves the retention clause out when no retention is set', async () => {
    const done = runCommand(0)

    expect(
      await screen.findByText(
        'This deletes session data that no worktree uses any more. You cannot undo this.'
      )
    ).toBeInTheDocument()
    expect(screen.queryByText(/older than/)).not.toBeInTheDocument()

    await cancelDialog()
    await done
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    )
  })
})
