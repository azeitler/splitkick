import type { Page } from '@playwright/test'
import { test, expect, asDesktopApp } from '../fixtures/tauri-mock'
import {
  createProject,
  createSession,
  createWorktree,
  mockPreferences,
  mockUIState,
} from '../fixtures/mock-data'

/**
 * Scheduled view: each schedule lists the runs it started, with session,
 * place and state, and a click opens the session. Sample data only.
 */

const now = Math.floor(Date.now() / 1000)
const project = createProject({
  name: 'Acme Web',
  path: '/tmp/e2e-scheduled-runs/acme',
})
const sessions = [
  createSession({ name: 'Nightly check · today', last_run_status: 'running' }),
  createSession({ name: 'Nightly check · yesterday', waiting_for_input: true }),
  createSession({
    name: 'Nightly check · 2 days ago',
    last_run_status: 'completed',
  }),
  createSession({
    name: 'Nightly check · 3 days ago',
    last_run_status: 'cancelled',
  }),
]
const worktree = createWorktree(project.id, {
  name: 'fuzzy-tiger',
  path: '/tmp/e2e-scheduled-runs/acme/.worktrees/w1',
  sessions,
})
const day = 86_400

// Newest last, as the backend stores it: 12 fires, one of them skipped and
// one failed, the newest still running.
const history = [
  ...Array.from({ length: 6 }, (_, i) => ({
    fired_at_unix: now - (12 - i) * day,
    outcome: 'queued',
    session_id: sessions[2].id,
    end: 'completed',
  })),
  { fired_at_unix: now - 6 * day, outcome: 'skipped' },
  {
    fired_at_unix: now - 5 * day,
    outcome: 'failed',
    error: 'The worktree no longer exists',
  },
  {
    fired_at_unix: now - 4 * day,
    outcome: 'queued',
    session_id: sessions[2].id,
    end: 'failed',
    error: 'Model not available',
  },
  {
    fired_at_unix: now - 3 * day,
    outcome: 'queued',
    session_id: sessions[3].id,
    end: 'cancelled',
  },
  {
    fired_at_unix: now - 1 * day,
    outcome: 'queued',
    session_id: sessions[1].id,
    end: 'waiting',
  },
  { fired_at_unix: now - 600, outcome: 'queued', session_id: sessions[0].id },
]

const schedules = [
  {
    id: 'nightly',
    origin: 'user',
    name: 'Nightly check',
    enabled: true,
    target: 'new_session',
    session_id: sessions[0].id,
    worktree_id: worktree.id,
    prompt: 'Run the checks and report what failed',
    reason: '',
    fire_at_unix: now + 3600 * 10,
    created_at_unix: now - 30 * day,
    recurrence: { cron: '0 2 * * *', tz: 'UTC' },
    last_run_unix: now - 600,
    last_outcome: 'queued',
    last_session_id: sessions[0].id,
    history,
  },
  {
    id: 'once',
    origin: 'user',
    name: 'Release reminder',
    enabled: true,
    session_id: sessions[2].id,
    worktree_id: worktree.id,
    prompt: 'Remind me to tag the release',
    reason: '',
    fire_at_unix: now + day,
    created_at_unix: now - 3600,
  },
]

const shotDir = process.env.SCHEDULED_RUNS_SCREENSHOT_DIR
const shotStamp = process.env.SCHEDULED_RUNS_SCREENSHOT_STAMP ?? 'shot'

async function shot(page: Page, name: string) {
  if (shotDir) {
    await page.screenshot({ path: `${shotDir}/${name}-${shotStamp}.png` })
  }
}

test.use({
  viewport: { width: 1280, height: 860 },
  responseOverrides: {
    list_projects: [project],
    list_worktrees: [worktree],
    list_all_sessions: {
      entries: [
        {
          project_id: project.id,
          project_name: project.name,
          worktree_id: worktree.id,
          worktree_name: worktree.name,
          worktree_path: worktree.path,
          sessions,
        },
      ],
    },
    list_schedules: schedules,
    load_preferences: {
      ...mockPreferences,
      zoom_level: 100,
      has_seen_feature_tour: true,
    },
    load_ui_state: {
      ...mockUIState,
      active_project_id: project.id,
      expanded_project_ids: [project.id],
      left_sidebar_visible: true,
      left_sidebar_size: 250,
    },
  },
})

test('Scheduled is a sidebar tab: the list in the panel, a schedule with its runs in the main area', async ({
  mockPage,
}) => {
  await asDesktopApp(mockPage)
  const navItem = (id: string) =>
    mockPage.getByTestId(`vertical-nav-${id}`).first()

  await navItem('recent').click()
  await expect(navItem('recent')).toHaveAttribute('aria-current', 'page')

  // The tab: Recent is no longer marked, the panel lists the schedules.
  await navItem('scheduled').click()
  await expect(navItem('scheduled')).toHaveAttribute('aria-current', 'page')
  await expect(navItem('recent')).not.toHaveAttribute('aria-current')
  const section = mockPage.getByTestId('sidebar-scheduled-section')
  const nightlyRow = section.getByTestId('sidebar-schedule-row-nightly')
  await expect(nightlyRow).toContainText('Nightly check')
  await expect(nightlyRow).toContainText(/in \d+h · daily at 02:00/)
  await expect(
    nightlyRow.getByTestId('sidebar-schedule-last-state')
  ).toHaveAttribute('data-state', 'running')
  await expect(section.getByTestId('sidebar-schedule-row-once')).toContainText(
    'Release reminder'
  )

  // A row opens the schedule: settings at the top, then the runs.
  await nightlyRow.click()
  await expect(nightlyRow).toHaveAttribute('aria-current', 'page')
  const detail = mockPage.getByTestId('schedule-detail')
  await expect(
    detail.getByRole('heading', { name: 'Nightly check' })
  ).toBeVisible()
  await expect(detail.getByTestId('schedule-detail-prompt')).toContainText(
    'Run the checks and report what failed'
  )
  await expect(detail).toContainText('a new session each run')
  await expect(detail).toContainText('daily at 02:00')
  const runs = detail.getByTestId('schedule-run')
  await expect(runs).toHaveCount(10)
  await expect(runs.nth(0)).toContainText('Nightly check · today')
  await expect(runs.nth(0)).toContainText('Running')
  await expect(runs.nth(0)).toContainText(/10m ago \(.+\)/)
  await expect(runs.nth(1)).toContainText('Waiting for input')
  await expect(runs.nth(2)).toContainText('Cancelled')
  await expect(runs.nth(3)).toContainText('Failed')
  await expect(runs.nth(3)).toContainText('Model not available')
  await expect(runs.nth(4)).toContainText('No session')
  await expect(runs.nth(5)).toContainText('Skipped')
  await expect(runs.nth(6)).toContainText('Completed')
  await shot(mockPage, 'scheduled-tab-detail')

  await detail.getByRole('button', { name: 'Show all 12' }).click()
  await expect(runs).toHaveCount(12)

  // A schedule that never ran says so.
  await section.getByTestId('sidebar-schedule-row-once').click()
  await expect(detail.getByTestId('schedule-runs-empty')).toBeVisible()

  // Archived marks only itself; a tab click leaves it again.
  await navItem('archived').click()
  await expect(navItem('archived')).toHaveAttribute('aria-current', 'page')
  await expect(navItem('scheduled')).not.toHaveAttribute('aria-current')
  await expect(mockPage.getByTestId('archived-view')).toBeVisible()
  await shot(mockPage, 'scheduled-tab-archived')
  await navItem('scheduled').click()
  await expect(navItem('scheduled')).toHaveAttribute('aria-current', 'page')
  await expect(navItem('archived')).not.toHaveAttribute('aria-current')

  // A run opens its session.
  await section.getByTestId('sidebar-schedule-row-nightly').click()
  await runs.nth(1).getByRole('button').click()
  await expect(mockPage.getByTestId('schedule-detail')).toHaveCount(0)
})
