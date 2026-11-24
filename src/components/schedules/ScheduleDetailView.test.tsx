import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import {
  cancelDialog,
  confirmDialog,
  render,
  screen,
  waitFor,
} from '@/test/test-utils'
import { useUIStore } from '@/store/ui-store'
import type { AllSessionsResponse, Schedule } from '@/types/chat'
import {
  ScheduleDetailView,
  lastRunText,
  nextRunText,
  settingsText,
} from './ScheduleDetailView'

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
vi.mock('@/services/agents', () => ({
  useAgents: () => ({ data: [{ id: 'a1', name: 'Assistant' }] }),
}))
vi.mock('@/lib/navigate-to-session', () => ({
  navigateToSession: mocks.navigateToSession,
}))

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
const nowSec = Math.floor(Date.now() / 1000)
const inOneHour = nowSec + 3600

function schedule(overrides: Partial<Schedule>): Schedule {
  return {
    id: 'sch-1',
    origin: 'user',
    session_id: 's1',
    worktree_id: 'w1',
    prompt: 'check the build',
    reason: '',
    fire_at_unix: inOneHour,
    created_at_unix: nowSec - 86_400,
    ...overrides,
  }
}

function show(scheduleId = 'sch-1') {
  return render(<ScheduleDetailView scheduleId={scheduleId} />)
}

describe('ScheduleDetailView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useUIStore.setState({ activeScheduleId: 'sch-1' })
    mocks.sessions = {
      entries: [
        {
          project_id: 'p1',
          project_name: 'Acme',
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

  it('shows the settings at the top and the runs below', async () => {
    mocks.schedules = [
      schedule({
        name: 'Nightly',
        target: 'new_session',
        recurrence: { cron: '0 9 * * *', tz },
        last_run_unix: nowSec - 7200,
        last_outcome: 'queued',
        last_session_id: 's-last',
        template: { backend: 'claude', model: 'opus', executionMode: 'yolo' },
        history: [
          {
            fired_at_unix: nowSec - 7200,
            outcome: 'queued',
            session_id: 's-last',
            end: 'completed',
          },
        ],
      }),
    ]
    show()

    expect(screen.getByRole('heading', { name: 'Nightly' })).toBeInTheDocument()
    expect(screen.getByText('User')).toBeInTheDocument()
    expect(screen.getByText('Yolo')).toBeInTheDocument()
    expect(screen.getByTestId('schedule-detail-prompt')).toHaveTextContent(
      'check the build'
    )
    expect(
      screen.getByText('Acme › main › a new session each run')
    ).toBeInTheDocument()
    expect(screen.getByText('daily at 09:00')).toBeInTheDocument()
    expect(screen.getByText(/^2h ago \(.+\) · Completed$/)).toBeInTheDocument()
    expect(screen.getByText('claude · opus · yolo')).toBeInTheDocument()

    const [run] = screen.getAllByTestId('schedule-run')
    expect(run).toHaveTextContent('Nightly run 3 · Acme › main')
    expect(run).toHaveTextContent('Completed')
    await userEvent.click(screen.getByRole('button', { name: /Nightly run 3/ }))
    expect(mocks.navigateToSession).toHaveBeenCalledWith({
      projectId: 'p1',
      worktreeId: 'w1',
      sessionId: 's-last',
    })
  })

  it('links the session a schedule runs in and says when it has no runs', async () => {
    mocks.schedules = [schedule({})]
    show()
    expect(screen.getByTestId('schedule-runs-empty')).toHaveTextContent(
      'No runs yet.'
    )
    expect(
      screen.getByText("The session's settings when it runs")
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Release check' }))
    expect(mocks.navigateToSession).toHaveBeenCalledWith({
      projectId: 'p1',
      worktreeId: 'w1',
      sessionId: 's1',
    })
  })

  // An agent schedule follows the agent; the session it was made in is not
  // where the next run goes.
  it('names the agent a schedule runs for', () => {
    mocks.schedules = [
      schedule({ id: 'x', target: 'agent', agent_id: 'a1' }),
      schedule({ id: 'y', target: 'agent', agent_id: 'gone' }),
    ]
    const { unmount } = show('x')
    expect(
      screen.getByText('Agent Assistant, in its current session')
    ).toBeInTheDocument()
    unmount()
    show('y')
    expect(screen.getByText('An agent that was removed')).toBeInTheDocument()
  })

  it('pauses, runs now and deletes, then closes', async () => {
    mocks.schedules = [schedule({ id: 'on' })]
    show('on')
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(mocks.setScheduleEnabled).toHaveBeenCalledWith('on', false)

    await userEvent.click(screen.getByRole('button', { name: 'Run now' }))
    expect(mocks.runScheduleNow).toHaveBeenCalledWith('on')

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await confirmDialog()
    await waitFor(() => expect(mocks.deleteSchedule).toHaveBeenCalledWith('on'))
    await waitFor(() =>
      expect(useUIStore.getState().activeScheduleId).toBeNull()
    )
  })

  it('resumes a paused schedule and shows its error', async () => {
    mocks.schedules = [
      schedule({ id: 'off', enabled: false, last_error: 'gone' }),
    ]
    show('off')
    expect(screen.getByText('Paused', { selector: 'dd' })).toBeInTheDocument()
    expect(screen.getByText('gone')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(mocks.setScheduleEnabled).toHaveBeenCalledWith('off', true)
  })

  it('keeps the schedule when the delete confirmation is cancelled', async () => {
    mocks.schedules = [schedule({ id: 'on' })]
    show('on')
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await cancelDialog()
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    )
    expect(mocks.deleteSchedule).not.toHaveBeenCalled()
  })

  it('edits a schedule through the dialog', async () => {
    mocks.schedules = [schedule({ id: 'e1' })]
    show('e1')
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

  it('says so when the schedule is gone', () => {
    mocks.schedules = []
    show('done')
    expect(screen.getByTestId('schedule-detail-missing')).toHaveTextContent(
      'no longer exists'
    )
  })
})

describe('detail texts', () => {
  it('says Paused instead of a next time', () => {
    expect(nextRunText(schedule({ enabled: false }))).toBe('Paused')
    expect(nextRunText(schedule({}), (inOneHour - 3600) * 1000)).toMatch(
      /^in 1h \(/
    )
  })

  it('has no last result before the first run', () => {
    expect(lastRunText(schedule({}))).toBeNull()
  })

  it('shows the stored outcome for a schedule without history', () => {
    expect(
      lastRunText(
        schedule({ last_run_unix: nowSec - 60, last_outcome: 'skipped' })
      )
    ).toMatch(/ · skipped$/)
  })

  it('lists the captured run settings, or none', () => {
    expect(settingsText(schedule({}))).toBeNull()
    expect(
      settingsText(schedule({ template: { model: 'opus', pendingImages: [] } }))
    ).toBe('opus')
  })
})
