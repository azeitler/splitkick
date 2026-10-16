import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invoke, remoteInvoke, activateConnection, toast } = vi.hoisted(() => ({
  invoke: vi.fn(),
  remoteInvoke: vi.fn(),
  activateConnection: vi.fn(),
  toast: { loading: vi.fn(() => 'toast-1'), success: vi.fn(), error: vi.fn() },
}))

const connections = [
  { id: 'current', name: 'This Window', url: 'https://c', token: 'c' },
  { id: 'studio', name: 'Studio', url: 'https://s', token: 's' },
]

vi.mock('@/lib/transport', () => ({ invoke }))
vi.mock('@/lib/remote-invoke', () => ({ remoteInvoke }))
vi.mock('@/lib/connection-windows', () => ({ activateConnection }))
vi.mock('sonner', () => ({ toast }))
vi.mock('@/lib/remote-connections', () => ({
  getActiveConnectionId: () => 'current',
  useRemoteConnections: () => connections,
}))

import { useUIStore } from '@/store/ui-store'
import { TransferSessionDialog } from './TransferSessionDialog'

function renderDialog() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <TransferSessionDialog />
    </QueryClientProvider>
  )
}

describe('TransferSessionDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invoke.mockImplementation(async (command: string) => {
      if (command === 'get_worktree') {
        return { id: 'w1', project_id: 'p-local', branch: 'feature-x' }
      }
      if (command === 'list_projects') {
        return [{ id: 'p-local', name: 'shop' }]
      }
      if (command === 'export_session_bundle') return { formatVersion: 1 }
      throw new Error(`unexpected ${command}`)
    })
    remoteInvoke.mockImplementation(
      async (_conn: unknown, command: string, args: { projectId?: string }) => {
        if (command === 'list_projects') {
          return [
            { id: 'r-other', name: 'blog' },
            { id: 'r-folder', name: 'Group', is_folder: true },
            { id: 'r-shop', name: 'shop' },
          ]
        }
        if (command === 'list_worktrees' && args.projectId === 'r-shop') {
          return [
            { id: 'rw-main', name: 'shop', branch: 'main' },
            { id: 'rw-x', name: 'fuzzy-tiger', branch: 'feature-x' },
          ]
        }
        if (command === 'import_session_bundle') {
          return { id: 'remote-session', name: 'Build auth' }
        }
        return []
      }
    )
    useUIStore.setState({
      transferSessionTarget: { worktreeId: 'w1', sessionId: 's1' },
    })
  })

  it('preselects the same project and branch, without the current window', async () => {
    renderDialog()

    const connection = screen.getByLabelText('Connection') as HTMLSelectElement
    expect([...connection.options].map(option => option.text)).toEqual([
      'Studio',
    ])
    await waitFor(() =>
      expect(
        (screen.getByLabelText('Worktree') as HTMLSelectElement).value
      ).toBe('rw-x')
    )
    const project = screen.getByLabelText('Project') as HTMLSelectElement
    expect(project.value).toBe('r-shop')
    expect([...project.options].map(option => option.text)).not.toContain(
      'Group'
    )
  })

  it('exports locally, imports into the chosen remote worktree, offers Open', async () => {
    renderDialog()
    await waitFor(() =>
      expect(
        (screen.getByLabelText('Worktree') as HTMLSelectElement).value
      ).toBe('rw-x')
    )
    fireEvent.change(screen.getByLabelText('Worktree'), {
      target: { value: 'rw-main' },
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Transfer' }))
    })

    expect(useUIStore.getState().transferSessionTarget).toBeNull()
    expect(invoke).toHaveBeenCalledWith('export_session_bundle', {
      worktreeId: 'w1',
      sessionId: 's1',
    })
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    expect(remoteInvoke).toHaveBeenCalledWith(
      connections[1],
      'import_session_bundle',
      { worktreeId: 'rw-main', bundle: { formatVersion: 1 } },
      expect.anything()
    )
    const [, options] = toast.success.mock.calls[0] as unknown as [
      string,
      { id: string; action: { onClick: () => void } },
    ]
    expect(options.id).toBe('toast-1')
    options.action.onClick()
    expect(activateConnection).toHaveBeenCalledWith('studio')
  })

  it('shows the import error in the same toast', async () => {
    remoteInvoke.mockImplementation(async (_conn: unknown, command: string) => {
      if (command === 'import_session_bundle') {
        throw new Error('Update Splitkick on Studio: it is too old.')
      }
      if (command === 'list_projects') return [{ id: 'r-shop', name: 'shop' }]
      return [{ id: 'rw-x', name: 'x', branch: 'feature-x' }]
    })
    renderDialog()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Transfer' })).toBeEnabled()
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Transfer' }))
    })

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Transfer failed: Update Splitkick on Studio: it is too old.',
        { id: 'toast-1' }
      )
    )
  })

  it('shows a remote list error inline', async () => {
    remoteInvoke.mockRejectedValue(
      new Error('Invalid access token for Studio.')
    )
    renderDialog()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Invalid access token for Studio.'
    )
    expect(screen.getByRole('button', { name: 'Transfer' })).toBeDisabled()
  })
})
