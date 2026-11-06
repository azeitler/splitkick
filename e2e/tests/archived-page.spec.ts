import { test, expect, ensureSidebarOpen } from '../fixtures/tauri-mock'
import { mockPreferences, mockUIState } from '../fixtures/mock-data'
import { archivedDemoData } from '../fixtures/archived-demo-data'

/**
 * The Archived page (#96): last archived first in time sections, filters,
 * sort, and the phone layout. The mock has no Tauri IPC, so it runs as Web
 * Access: no keyboard hints.
 */

const demo = archivedDemoData()

const overrides = {
  list_projects: demo.projects,
  list_worktrees: demo.worktrees,
  list_archived_worktrees: demo.archivedWorktrees,
  list_all_archived_sessions: demo.archivedSessions,
  search_session_messages: { hits: [], truncated: false },
  load_preferences: { ...mockPreferences, zoom_level: 100 },
  load_ui_state: { ...mockUIState, active_project_id: null },
}

const rows = (page: import('@playwright/test').Page) =>
  page.getByTestId('archived-row')

test.describe('Archived page', () => {
  test.use({ responseOverrides: overrides })

  test.beforeEach(async ({ mockPage }) => {
    await ensureSidebarOpen(mockPage)
    await mockPage.getByTestId('sidebar-archived-row').click()
    await expect(mockPage.getByTestId('archived-view')).toBeVisible()
  })

  test('lists the last archived first, in time sections', async ({
    mockPage,
  }) => {
    const view = mockPage.getByTestId('archived-view')
    await expect(rows(mockPage)).toHaveCount(18)
    await expect(view.getByRole('heading', { level: 2 })).toHaveText([
      /^Today/,
      /^Yesterday/,
      /^This week/,
      /^This month/,
      /^Older/,
    ])
    const first = rows(mockPage).first()
    await expect(first).toContainText('Fix flaky upload test')
    await expect(first).toContainText('acme-web › main')
    await expect(first).toContainText(/Archived 12m ago \(.+\)/)
    await expect(first).toContainText(
      'The upload test fails one run in ten on CI'
    )
    // Web Access: no keyboard hints.
    await expect(view.getByText('restore and open')).toHaveCount(0)
  })

  test('filters, sorts and remembers the sort', async ({ mockPage }) => {
    const view = mockPage.getByTestId('archived-view')
    await view.getByRole('radio', { name: /Worktrees/ }).click()
    await expect(rows(mockPage)).toHaveCount(5)
    await expect(rows(mockPage).first()).toContainText('PR merged')

    await view.getByRole('radio', { name: /^All/ }).click()
    await view.getByLabel('Search archived items').fill('invoice-pdf')
    await expect(rows(mockPage)).toHaveCount(1)
    await view.getByLabel('Search archived items').fill('')

    await view.getByLabel('Sort').selectOption('project')
    await expect(view.getByRole('heading', { level: 2 })).toHaveText([
      /^acme-web/,
      /^billing-api/,
      /^docs-site/,
    ])
  })
})

test.describe('Archived page on a phone', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    responseOverrides: {
      ...overrides,
      load_preferences: {
        ...mockPreferences,
        zoom_level: 100,
        mobile_zoom_level: 100,
      },
    },
  })

  test('opens as a full-screen dialog with one column', async ({
    mockPage,
  }) => {
    // Home › Projects › Archived, the phone's way in.
    await mockPage.getByTestId('mobile-home-segment-projects').click()
    await mockPage
      .getByRole('button', { name: 'Archived', exact: true })
      .click()
    const dialog = mockPage.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(rows(mockPage).first()).toContainText('Fix flaky upload test')
    const box = await rows(mockPage).first().boundingBox()
    // One column: the row spans (almost) the whole phone width.
    expect(box?.width ?? 0).toBeGreaterThan(320)
    // Row actions are visible without hover on a touch screen.
    await expect(
      rows(mockPage)
        .first()
        .getByRole('button', { name: /More actions/ })
    ).toBeVisible()
  })
})
