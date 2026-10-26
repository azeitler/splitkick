import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { ScheduledBanner } from './ScheduledBanner'
import type { Schedule } from '@/types/chat'
import type * as Environment from '@/lib/environment'

const invoke = vi.fn()

vi.mock('@/lib/transport', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}))

vi.mock('@/lib/environment', async importOriginal => ({
  ...(await importOriginal<typeof Environment>()),
  hasBackend: () => true,
}))

const nowUnix = Math.floor(Date.now() / 1000)

function schedule(id: string, sessionId: string, prompt: string): Schedule {
  return {
    id,
    origin: 'user',
    session_id: sessionId,
    worktree_id: 'w1',
    prompt,
    reason: '',
    fire_at_unix: nowUnix + 2 * 3600 + 60,
    created_at_unix: nowUnix,
  }
}

describe('ScheduledBanner', () => {
  it('lists only the session schedules with the time until they fire', async () => {
    invoke.mockResolvedValue([
      schedule('a', 's1', 'check the build'),
      schedule('b', 's2', 'other session'),
    ])

    render(<ScheduledBanner sessionId="s1" />)

    expect(await screen.findByText('check the build')).toBeInTheDocument()
    expect(screen.queryByText('other session')).not.toBeInTheDocument()
    expect(screen.getByText(/Scheduled · in 2h/)).toBeInTheDocument()
  })

  it('cancels a schedule', async () => {
    invoke.mockImplementation((command: string) =>
      command === 'list_schedules'
        ? Promise.resolve([schedule('a', 's1', 'check the build')])
        : Promise.resolve(true)
    )

    render(<ScheduledBanner sessionId="s1" />)

    fireEvent.click(
      await screen.findByRole('button', { name: 'Cancel schedule' })
    )

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('delete_schedule', {
        scheduleId: 'a',
      })
    })
  })

  it('renders nothing without schedules', async () => {
    invoke.mockResolvedValue([])
    const { container } = render(<ScheduledBanner sessionId="s1" />)
    await waitFor(() => expect(invoke).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
