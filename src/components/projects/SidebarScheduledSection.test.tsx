import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@/test/test-utils'
import { useUIStore } from '@/store/ui-store'
import type { AllSessionsResponse, Schedule } from '@/types/chat'
import {
  SidebarScheduledSection,
  scheduleSubtitle,
} from './SidebarScheduledSection'

const mocks = vi.hoisted(() => ({
  schedules: [] as Schedule[],
  sessions: undefined as AllSessionsResponse | undefined,
  openScheduleView: vi.fn(),
  isMobile: false,
}))

vi.mock('@/services/schedules', () => ({
  useSchedules: () => ({ data: mocks.schedules }),
}))
vi.mock('@/services/chat', () => ({
  useAllSessions: () => ({ data: mocks.sessions }),
}))
vi.mock('@/lib/scheduled-view', () => ({
  openScheduleView: mocks.openScheduleView,
}))
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => mocks.isMobile }))

const nowSec = Math.floor(Date.now() / 1000)
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone

function schedule(overrides: Partial<Schedule>): Schedule {
  return {
    id: 'sch-1',
    origin: 'user',
    session_id: 's1',
    worktree_id: 'w1',
    prompt: 'check the build',
    reason: '',
    fire_at_unix: nowSec + 7200,
    created_at_unix: 0,
    ...overrides,
  }
}

describe('SidebarScheduledSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isMobile = false
    mocks.sessions = {
      entries: [
        {
          project_id: 'p1',
          project_name: 'Acme',
          worktree_id: 'w1',
          worktree_name: 'main',
          worktree_path: '/tmp/w1',
          sessions: [
            { id: 's1', name: 'Release check', last_run_status: 'completed' },
          ] as AllSessionsResponse['entries'][number]['sessions'],
        },
      ],
    }
    useUIStore.setState({ activeScheduleId: null, leftSidebarVisible: true })
  })

  it('explains how to schedule when nothing is scheduled', () => {
    mocks.schedules = []
    render(<SidebarScheduledSection />)
    expect(screen.getByTestId('sidebar-scheduled-empty')).toHaveTextContent(
      'Nothing is scheduled'
    )
  })

  it('lists active schedules first, with the last run state, and opens one', async () => {
    mocks.schedules = [
      schedule({ id: 'paused', name: 'Paused digest', enabled: false }),
      schedule({
        id: 'nightly',
        name: 'Nightly',
        recurrence: { cron: '0 9 * * *', tz },
        history: [
          {
            fired_at_unix: nowSec - 600,
            outcome: 'queued',
            session_id: 's1',
            end: 'failed',
          },
        ],
      }),
    ]
    useUIStore.setState({ activeScheduleId: 'nightly' })
    render(<SidebarScheduledSection />)

    const rows = screen.getAllByRole('button')
    expect(rows.map(r => r.textContent)).toEqual([
      expect.stringContaining('Nightly'),
      expect.stringContaining('Paused digest'),
    ])
    expect(rows[0]).toHaveAttribute('aria-current', 'page')
    expect(rows[0]).toHaveTextContent(/in \dh · daily at 09:00/)
    expect(rows[1]).toHaveTextContent('Paused · once')
    expect(screen.getByTestId('sidebar-schedule-last-state')).toHaveAttribute(
      'data-state',
      'failed'
    )

    await userEvent.click(rows[1] as HTMLElement)
    expect(mocks.openScheduleView).toHaveBeenCalledWith('paused')
    expect(useUIStore.getState().leftSidebarVisible).toBe(true)
  })

  it('hides the sidebar on mobile after a pick', async () => {
    mocks.isMobile = true
    mocks.schedules = [schedule({})]
    render(<SidebarScheduledSection />)
    await userEvent.click(screen.getByRole('button'))
    expect(useUIStore.getState().leftSidebarVisible).toBe(false)
  })
})

describe('scheduleSubtitle', () => {
  it('says Paused instead of the next time', () => {
    expect(scheduleSubtitle(schedule({ enabled: false }), Date.now())).toBe(
      'Paused · once'
    )
  })
})
