import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invoke, moveSession, toast } = vi.hoisted(() => ({
  invoke: vi.fn(),
  moveSession: vi.fn(),
  toast: { loading: vi.fn(() => 'toast-1'), success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/lib/transport', () => ({ invoke }))
vi.mock('@/lib/session-move', () => ({ moveSession }))
vi.mock('sonner', () => ({ toast }))

import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'
import type { QueuedMessage } from '@/types/chat'
import { MoveSessionDialog } from './MoveSessionDialog'

function renderDialog() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <MoveSessionDialog />
    </QueryClientProvider>
  )
}

function open() {
  act(() => {
    useUIStore
      .getState()
      .setMoveSessionTarget({ worktreeId: 'w-current', sessionId: 's1' })
  })
}

const projectSelect = () => screen.getByLabelText('Project')
const worktreeSelect = () => screen.getByLabelText('Worktree')
const moveButton = () => screen.getByRole('button', { name: 'Move' })

describe('MoveSessionDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useUIStore.setState({ moveSessionTarget: null })
    useChatStore.setState({ sendingSessionIds: {}, messageQueues: {} })
    moveSession.mockResolvedValue({ status: 'moved' })
    invoke.mockImplementation(
      async (command: string, args?: { projectId?: string }) => {
        if (command === 'list_projects') {
          return [
            { id: 'p-shop', name: 'shop' },
            { id: 'p-folder', name: 'Group', is_folder: true },
            { id: 'p-blog', name: 'blog' },
          ]
        }
        if (command === 'list_worktrees' && args?.projectId === 'p-shop') {
          return [
            { id: 'w-current', name: 'current', branch: 'feature-x' },
            { id: 'w-main', name: 'shop', branch: 'main' },
            { id: 'w-old', name: 'old', branch: 'old', archived_at: 5 },
          ]
        }
        if (command === 'list_worktrees' && args?.projectId === 'p-blog') {
          return [{ id: 'w-blog', name: 'blog', branch: 'main' }]
        }
        throw new Error(`unexpected ${command}`)
      }
    )
  })

  it('preselects nothing and keeps Move disabled until both are picked', async () => {
    renderDialog()
    open()

    await screen.findByRole('option', { name: 'shop' })
    expect(projectSelect()).toHaveValue('')
    expect(screen.queryByRole('option', { name: 'Group' })).toBeNull()
    expect(moveButton()).toBeDisabled()

    fireEvent.change(projectSelect(), { target: { value: 'p-shop' } })
    await screen.findByRole('option', { name: 'shop (main)' })
    expect(worktreeSelect()).toHaveValue('')
    expect(moveButton()).toBeDisabled()
  })

  it('lists neither the current nor archived worktrees', async () => {
    renderDialog()
    open()
    await screen.findByRole('option', { name: 'shop' })

    fireEvent.change(projectSelect(), { target: { value: 'p-shop' } })
    await screen.findByRole('option', { name: 'shop (main)' })

    expect(screen.queryByRole('option', { name: /feature-x/ })).toBeNull()
    expect(screen.queryByRole('option', { name: /old/ })).toBeNull()
  })

  it('resets the worktree when the project changes', async () => {
    renderDialog()
    open()
    await screen.findByRole('option', { name: 'shop' })
    fireEvent.change(projectSelect(), { target: { value: 'p-shop' } })
    await screen.findByRole('option', { name: 'shop (main)' })
    fireEvent.change(worktreeSelect(), { target: { value: 'w-main' } })
    expect(moveButton()).toBeEnabled()

    fireEvent.change(projectSelect(), { target: { value: 'p-blog' } })

    await screen.findByRole('option', { name: 'blog (main)' })
    expect(worktreeSelect()).toHaveValue('')
    expect(moveButton()).toBeDisabled()
  })

  it('moves the session and closes', async () => {
    renderDialog()
    open()
    await screen.findByRole('option', { name: 'blog' })
    fireEvent.change(projectSelect(), { target: { value: 'p-blog' } })
    await screen.findByRole('option', { name: 'blog (main)' })
    fireEvent.change(worktreeSelect(), { target: { value: 'w-blog' } })

    fireEvent.click(moveButton())

    await waitFor(() => expect(moveSession).toHaveBeenCalledWith('s1', 'w-blog'))
    expect(useUIStore.getState().moveSessionTarget).toBeNull()
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Moved session to blog', {
        id: 'toast-1',
      })
    )
  })

  it('reports a failed move', async () => {
    moveSession.mockRejectedValue('Session is running')
    renderDialog()
    open()
    await screen.findByRole('option', { name: 'blog' })
    fireEvent.change(projectSelect(), { target: { value: 'p-blog' } })
    await screen.findByRole('option', { name: 'blog (main)' })
    fireEvent.change(worktreeSelect(), { target: { value: 'w-blog' } })

    fireEvent.click(moveButton())

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Failed to move session: Session is running',
        { id: 'toast-1' }
      )
    )
  })

  it('refuses a running session', async () => {
    useChatStore.setState({ sendingSessionIds: { s1: true } })
    renderDialog()
    open()
    await screen.findByRole('option', { name: 'blog' })

    expect(screen.getByRole('alert')).toHaveTextContent(/running/i)
    expect(moveButton()).toBeDisabled()
  })

  it('refuses a session with queued messages', async () => {
    useChatStore.setState({
      messageQueues: { s1: [{ id: 'q1' } as QueuedMessage] },
    })
    renderDialog()
    open()
    await screen.findByRole('option', { name: 'blog' })

    expect(screen.getByRole('alert')).toHaveTextContent(/queued/i)
    expect(moveButton()).toBeDisabled()
  })
})
