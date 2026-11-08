import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, within } from '@/test/test-utils'
import type { AllSessionsResponse, Schedule } from '@/types/chat'
import { ScheduledList, lastRunText, nextRunText } from './ScheduledView'

const mocks = vi.hoisted(() => ({
  schedules: [] as Schedule[],
  sessions: undefined as AllSessionsResponse | undefined,
  setScheduleEnabled: vi.fn().mockResolvedValue({}),
  runScheduleNow: vi.fn().mockResolvedValue('s-new'),
  deleteSchedule: vi.fn().mockResolvedValue(true),
  updateSchedule: vi.fn().mockResolvedValue({}),
  navigateToSession: vi.fn(),
}))

vi.mock('@/services/schedules', () => ({
  schedulesQueryKeys: { all: ['schedules'] },
  useSchedules: () => ({ data: mocks.schedules, isLoading: false }),
  setScheduleEnabled: mocks.setScheduleEnabled,
  runScheduleNow: mocks.runScheduleNow,
  deleteSchedule: mocks.deleteSchedule,
  updateSchedule: mocks.updateSchedule,
}))
vi.mock('@/services/chat', () => ({
  useAllSessions: () => ({ data: mocks.sessions }),
}))
vi.mock('@/lib/navigate-to-session', () => ({
  navigateToSession: mocks.navigateToSession,
}))

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
const inOneHour = Math.floor(Date.now() / 1000) + 3600

function schedule(overrides: Partial<Schedule>): Schedule {
  return {
    id: 'sch-1',
    origin: 'user',
    session_id: 's1',
    worktree_id: 'w1',
    prompt: 'check the build',
    reason: '',
    fire_at_unix: inOneHour,
    created_at_unix: 0,
    ...overrides,
  }
}

describe('ScheduledList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sessions = {
      entries: [
        {
          project_id: 'p1',
          project_name: 'Splitkick',
          worktree_id: 'w1',
          worktree_name: 'main',
          worktree_path: '/tmp/w1',
          sessions: [
            { id: 's1', name: 'Release check' },
            { id: 's-last', name: 'Nightly run 3' },
          ] as AllSessionsResponse['entries'][number]['sessions'],
        },
      ],
    }
  })

  it('shows name, target, rule, next run, last result and origin', async () => {
    mocks.schedules = [
      schedule({
        id: 'rep',
        name: 'Nightly',
        target: 'new_session',
        recurrence: { cron: '0 9 * * *', tz },
        last_run_unix: Math.floor(Date.now() / 1000) - 7200,
        last_outcome: 'queued',
        last_session_id: 's-last',
        template: { executionMode: 'yolo' },
      }),
      schedule({ id: 'agent', origin: 'agent', prompt: 'wake up' }),
    ]
    render(<ScheduledList />)

    const [rep, agent] = screen.getAllByTestId('scheduled-row')
    const repRow = within(rep as HTMLElement)
    expect(repRow.getByText('Nightly')).toBeInTheDocument()
    expect(repRow.getByText('User')).toBeInTheDocument()
    expect(repRow.getByText('Yolo')).toBeInTheDocument()
    expect(
      repRow.getByText('Splitkick › main › a new session each run')
    ).toBeInTheDocument()
    expect(repRow.getByText('daily at 09:00')).toBeInTheDocument()
    expect(repRow.getByText(/^2h ago \(.+\) · queued$/)).toBeInTheDocument()

    await userEvent.click(repRow.getByRole('button', { name: 'Nightly run 3' }))
    expect(mocks.navigateToSession).toHaveBeenCalledWith({
      projectId: 'p1',
      worktreeId: 'w1',
      sessionId: 's-last',
    })

    const agentRow = within(agent as HTMLElement)
    expect(agentRow.getByText('Agent')).toBeInTheDocument()
    expect(
      agentRow.getByText('Splitkick › main › Release check')
    ).toBeInTheDocument()
    expect(agentRow.getByText('Once')).toBeInTheDocument()
  })

  it('pauses, resumes, runs now and deletes', async () => {
    mocks.schedules = [
      schedule({ id: 'on' }),
      schedule({ id: 'off', enabled: false, last_error: 'gone' }),
    ]
    render(<ScheduledList />)
    const [on, off] = screen.getAllByTestId('scheduled-row')

    await userEvent.click(
      within(on as HTMLElement).getByRole('button', { name: 'Pause' })
    )
    expect(mocks.setScheduleEnabled).toHaveBeenCalledWith('on', false)

    const offRow = within(off as HTMLElement)
    expect(offRow.getByText('Paused', { selector: 'dd' })).toBeInTheDocument()
    expect(offRow.getByText('gone')).toBeInTheDocument()
    await userEvent.click(offRow.getByRole('button', { name: 'Resume' }))
    expect(mocks.setScheduleEnabled).toHaveBeenCalledWith('off', true)

    await userEvent.click(
      within(on as HTMLElement).getByRole('button', { name: 'Run now' })
    )
    expect(mocks.runScheduleNow).toHaveBeenCalledWith('on')

    await userEvent.click(
      within(on as HTMLElement).getByRole('button', { name: 'Delete' })
    )
    expect(mocks.deleteSchedule).toHaveBeenCalledWith('on')
  })

  it('edits a schedule through the dialog', async () => {
    mocks.schedules = [schedule({ id: 'e1' })]
    render(<ScheduledList />)
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(await screen.findByText('Edit schedule')).toBeInTheDocument()

    const prompt = screen.getByLabelText('Prompt')
    await userEvent.clear(prompt)
    await userEvent.type(prompt, 'new prompt')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(mocks.updateSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduleId: 'e1',
        prompt: 'new prompt',
        target: 'session',
      })
    )
  })

  it('explains how to schedule when the list is empty', () => {
    mocks.schedules = []
    render(<ScheduledList />)
    expect(screen.getByText('Nothing is scheduled.')).toBeInTheDocument()
  })
})

describe('row texts', () => {
  it('says Paused instead of a next time', () => {
    expect(nextRunText(schedule({ enabled: false }))).toBe('Paused')
    expect(nextRunText(schedule({}), (inOneHour - 3600) * 1000)).toMatch(
      /^in 1h \(/
    )
  })

  it('has no last result before the first run', () => {
    expect(lastRunText(schedule({}))).toBeNull()
  })
})
