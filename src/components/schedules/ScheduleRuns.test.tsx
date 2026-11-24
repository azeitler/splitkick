import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, within } from '@/test/test-utils'
import type {
  AllSessionsResponse,
  Schedule,
  ScheduleRun,
  Session,
} from '@/types/chat'
import {
  ScheduleRuns,
  VISIBLE_RUNS,
  scheduleRunState,
  sessionPlaces,
} from './ScheduleRuns'

const nowSec = Math.floor(Date.now() / 1000)

function session(overrides: Partial<Session> = {}): Session {
  return { id: 's1', name: 'Nightly run', ...overrides } as Session
}

function schedule(history: ScheduleRun[]): Schedule {
  return {
    id: 'sch-1',
    origin: 'user',
    session_id: 's1',
    worktree_id: 'w1',
    prompt: 'check the build',
    reason: '',
    fire_at_unix: nowSec + 3600,
    created_at_unix: 0,
    history,
  }
}

function queued(
  at: number,
  sessionId = 's1',
  extra: Partial<ScheduleRun> = {}
) {
  return {
    fired_at_unix: at,
    outcome: 'queued',
    session_id: sessionId,
    ...extra,
  } satisfies ScheduleRun
}

function sessions(list: Session[]): AllSessionsResponse {
  return {
    entries: [
      {
        project_id: 'p1',
        project_name: 'Acme',
        worktree_id: 'w1',
        worktree_name: 'main',
        worktree_path: '/tmp/w1',
        sessions: list,
      },
    ],
  }
}

describe('scheduleRunState', () => {
  it('uses the outcome of a fire that queued nothing', () => {
    for (const outcome of ['skipped', 'failed', 'still_queued'] as const) {
      const run: ScheduleRun = { fired_at_unix: 1, outcome }
      expect(scheduleRunState(run, schedule([run]), undefined)).toBe(outcome)
    }
  })

  it('uses the recorded end of a run', () => {
    for (const end of ['completed', 'cancelled', 'failed'] as const) {
      const run = queued(1, 's1', { end })
      expect(scheduleRunState(run, schedule([run]), session())).toBe(end)
    }
  })

  it('shows waiting only while the newest run still waits', () => {
    const older = queued(1, 's1', { end: 'waiting' })
    const newer = queued(2, 's1', { end: 'waiting' })
    const s = schedule([older, newer])
    const waiting = session({ waiting_for_input: true })
    expect(scheduleRunState(newer, s, waiting)).toBe('waiting')
    expect(scheduleRunState(older, s, waiting)).toBe('completed')
    expect(scheduleRunState(newer, s, session())).toBe('completed')
  })

  it('takes the live state of the session for an open run', () => {
    const run = queued(1)
    const s = schedule([run])
    expect(
      scheduleRunState(run, s, session({ last_run_status: 'running' }))
    ).toBe('running')
    expect(scheduleRunState(run, s, session({ waiting_for_input: true }))).toBe(
      'waiting'
    )
    expect(
      scheduleRunState(run, s, session({ last_run_status: 'crashed' }))
    ).toBe('failed')
    expect(scheduleRunState(run, s, undefined)).toBe('queued')
  })

  it('shows a prompt still in the queue as queued, the one before it as running', () => {
    const older = queued(1)
    const newer = queued(2)
    const s = schedule([older, newer])
    const live = session({
      last_run_status: 'running',
      queued_messages: [
        { id: 'q', message: 'check the build', scheduleId: 'sch-1' },
      ] as Session['queued_messages'],
    })
    expect(scheduleRunState(newer, s, live)).toBe('queued')
    expect(scheduleRunState(older, s, live)).toBe('running')
  })
})

describe('ScheduleRuns', () => {
  const places = sessionPlaces(
    sessions([
      session({ last_run_status: 'running' }),
      session({ id: 's2', name: 'Older run', last_run_status: 'completed' }),
    ])
  )

  it('renders nothing for a schedule that never ran', () => {
    const { container } = render(
      <ScheduleRuns
        schedule={schedule([])}
        places={places}
        now={Date.now()}
        onOpenSession={vi.fn()}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('is collapsed with a count and the last state, expands newest first and opens a session', async () => {
    const onOpen = vi.fn()
    const history: ScheduleRun[] = [
      queued(nowSec - 7200, 's2', { end: 'completed' }),
      {
        fired_at_unix: nowSec - 5400,
        outcome: 'failed',
        error: 'The worktree no longer exists',
      },
      queued(nowSec - 600),
    ]
    render(
      <ScheduleRuns
        schedule={schedule(history)}
        places={places}
        now={Date.now()}
        onOpenSession={onOpen}
      />
    )

    const toggle = screen.getByRole('button', { name: /3 runs/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveTextContent('last: Running')
    expect(screen.queryByTestId('schedule-runs')).not.toBeInTheDocument()

    await userEvent.click(toggle)
    const rows = screen.getAllByTestId('schedule-run')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('Nightly run · Acme › main')
    expect(rows[0]).toHaveTextContent('Running')
    expect(rows[0]).toHaveTextContent(/10m ago \(.+\)/)
    expect(rows[1]).toHaveTextContent('No session')
    expect(rows[1]).toHaveTextContent('Failed')
    expect(rows[1]).toHaveTextContent('The worktree no longer exists')
    expect(rows[2]).toHaveTextContent('Older run')
    expect(rows[2]).toHaveTextContent('Completed')

    await userEvent.click(
      within(rows[2] as HTMLElement).getByRole('button', { name: /Older run/ })
    )
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'p1',
        worktreeId: 'w1',
        session: expect.objectContaining({ id: 's2' }),
      })
    )

    await userEvent.click(screen.getByRole('button', { name: /3 runs/ }))
    expect(screen.queryByTestId('schedule-runs')).not.toBeInTheDocument()
  })

  it('shows the last runs and all of them on request', async () => {
    const history = Array.from({ length: VISIBLE_RUNS + 5 }, (_, i) =>
      queued(nowSec - 10_000 + i, 's2', { end: 'completed' })
    )
    render(
      <ScheduleRuns
        schedule={{ ...schedule(history), id: 'sch-many' }}
        places={places}
        now={Date.now()}
        onOpenSession={vi.fn()}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /15 runs/ }))
    expect(screen.getAllByTestId('schedule-run')).toHaveLength(VISIBLE_RUNS)

    await userEvent.click(screen.getByRole('button', { name: 'Show all 15' }))
    expect(screen.getAllByTestId('schedule-run')).toHaveLength(15)
  })
})
