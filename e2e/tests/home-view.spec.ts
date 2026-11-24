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
 * The Home view: projects grouped by the sidebar folders, and the columns at
 * three window widths. Sample data only.
 */

const clients = createProject({
  name: 'Clients',
  path: '',
  is_folder: true,
  order: 0,
})
const internal = createProject({
  name: 'Internal',
  path: '',
  is_folder: true,
  order: 1,
})
const archive = createProject({
  name: 'Archive',
  path: '',
  is_folder: true,
  parent_id: clients.id,
  order: 0,
})
const project = (name: string, order: number, parent_id?: string) =>
  createProject({
    name,
    path: `/tmp/e2e-home/${name.toLowerCase().replace(/\s+/g, '-')}`,
    order,
    ...(parent_id && { parent_id }),
  })
const acme = project('Acme Web', 1, clients.id)
const docs = project('Docs site with a rather long project name', 2, clients.id)
const oldPortal = project('Old portal', 0, archive.id)
const tools = project('Tools', 0, internal.id)
const design = project('Design system', 1, internal.id)
const mobile = project('Mobile app', 3)
const playground = project('Playground', 4)
// The home of a global agent: never on Home.
const agentHome = createProject({
  name: 'Agent home',
  path: '/tmp/e2e-home/agent-home',
  order: 5,
  hidden: true,
})
const projects = [
  clients,
  internal,
  archive,
  acme,
  docs,
  oldPortal,
  tools,
  design,
  mobile,
  playground,
  agentHome,
]
const realProjects = [acme, docs, oldPortal, tools, design, mobile, playground]

const now = Date.now() / 1000
const sessionNames = [
  'Fix login redirect',
  'Weekly report',
  'API design notes',
  'Refactor the settings pane and split it into smaller parts',
  'Release checklist',
  'Update dependencies',
  'Dark mode colours',
]
const worktrees = realProjects.map((p, i) =>
  createWorktree(p.id, {
    name: `work-${i + 1}`,
    path: `${p.path}/.worktrees/w${i + 1}`,
    sessions: [
      createSession({
        name: sessionNames[i],
        last_message_at: now - 60 * (i + 1) * 7,
        ...(i < 2 && { todo_at: now - 120 }),
      }),
    ],
  })
)
const entries = realProjects.map((p, i) => ({
  project_id: p.id,
  project_name: p.name,
  worktree_id: worktrees[i].id,
  worktree_name: worktrees[i].name,
  worktree_path: worktrees[i].path,
  sessions: worktrees[i].sessions,
}))

test.use({
  responseOverrides: {
    list_projects: projects,
    list_worktrees: worktrees,
    list_all_sessions: { entries },
    load_preferences: {
      ...mockPreferences,
      zoom_level: 100,
      has_seen_feature_tour: true,
    },
    load_ui_state: {
      ...mockUIState,
      active_project_id: null,
      left_sidebar_visible: true,
      starred_sessions: entries.slice(2, 4).map(entry => ({
        project_id: entry.project_id,
        worktree_id: entry.worktree_id,
        session_id: entry.sessions[0].id,
      })),
    },
  },
})

const shotDir = process.env.HOME_VIEW_SCREENSHOT_DIR
const shotStamp = process.env.HOME_VIEW_SCREENSHOT_STAMP ?? 'shot'

async function shot(page: Page, name: string) {
  if (shotDir) {
    await page.screenshot({ path: `${shotDir}/${name}-${shotStamp}.png` })
  }
}

async function openHome(page: Page, width: number) {
  await page.setViewportSize({ width, height: 860 })
  await asDesktopApp(page)
  await page.getByTestId('vertical-nav-home').first().click()
  await expect(page.getByTestId('home-view')).toBeVisible()
  await expect(page.getByText('Acme Web').first()).toBeVisible()
}

/** The number of columns the Home grid lays out. */
const columnCount = (page: Page) =>
  page
    .getByTestId('home-grid')
    .evaluate(
      el =>
        getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean)
          .length
    )

for (const [width, columns] of [
  [900, 1],
  [1280, 2],
  [1800, 3],
] as const) {
  test(`lays Home out in ${columns} column(s) at ${width} px`, async ({
    mockPage,
  }) => {
    await openHome(mockPage, width)
    await shot(mockPage, `home-${width}`)
    await expect.poll(() => columnCount(mockPage)).toBe(columns)

    // Nothing in a column reaches into its scroll bar's lane.
    const overflow = await mockPage
      .getByTestId('home-view')
      .evaluate(el =>
        [...el.querySelectorAll<HTMLElement>('[data-home-scroll]')].map(
          col => col.scrollWidth - col.clientWidth
        )
      )
    for (const value of overflow) expect(value).toBeLessThanOrEqual(0)
  })
}

test('groups the projects by the sidebar folders', async ({ mockPage }) => {
  await openHome(mockPage, 1280)
  const projectsSection = mockPage.getByTestId('home-projects')

  const groups = projectsSection.locator('[data-testid^="home-project-group-"]')
  await expect(groups).toHaveCount(4)
  await expect(
    projectsSection.getByTestId(`home-project-group-${clients.id}`)
  ).toContainText('Acme Web')
  await expect(
    projectsSection.getByTestId(`home-project-group-${archive.id}`)
  ).toContainText('Old portal')
  await expect(
    projectsSection.getByTestId(`home-project-group-${internal.id}`)
  ).toContainText('Design system')
  await expect(
    projectsSection.getByTestId('home-project-group-root')
  ).toContainText('Playground')
  await expect(projectsSection).not.toContainText('Agent home')

  // A folder header collapses its group.
  const header = projectsSection.getByRole('button', { name: /Internal/ })
  await header.click()
  await expect(projectsSection).not.toContainText('Design system')
  await header.click()
  await expect(projectsSection).toContainText('Design system')
})

/**
 * Headless browsers draw overlay scroll bars only (0 px wide), so this checks
 * the geometry that holds for both kinds: an overlay bar paints inside the
 * client edge of the scroll area, an always-visible one sits outside it in the
 * stable gutter. Content that ends 12 px or more before the client edge clears
 * either.
 */
for (const width of [900, 1280, 1800]) {
  test(`keeps the content clear of the scroll bar at ${width} px`, async ({
    mockPage,
  }) => {
    await openHome(mockPage, width)

    const gaps = await mockPage.getByTestId('home-view').evaluate(el =>
      [...el.querySelectorAll<HTMLElement>('[data-home-scroll]')]
        .filter(col => {
          // A dissolved wrapper (display: contents) has no box of its own.
          const style = getComputedStyle(col)
          return style.overflowY === 'auto' && style.display !== 'contents'
        })
        .map(col => {
          const clientEdge = col.getBoundingClientRect().left + col.clientWidth
          const right = Math.max(
            ...[...col.children].map(c => c.getBoundingClientRect().right)
          )
          return Math.round(clientEdge - right)
        })
    )
    expect(gaps.length).toBeGreaterThan(0)
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(12)
  })
}
