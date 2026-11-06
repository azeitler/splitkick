import {
  test,
  expect,
  ensureSidebarOpen,
  sidebar,
} from '../fixtures/tauri-mock'
import {
  createProject,
  createSession,
  createWorktree,
  mockPreferences,
  mockUIState,
} from '../fixtures/mock-data'

/**
 * Issue #99: a project's Graphs row in the sidebar, beside Pinned & Starred.
 * It lists graphs stored in the project, then graphs from elsewhere that one
 * of its sessions serves; an unrelated graph stays in the global section.
 */

const web = createProject({ name: 'acme-web', path: '/tmp/e2e-acme-web' })
const docs = createProject({ name: 'acme-docs', path: '/tmp/e2e-acme-docs' })
const pinned = createSession({ name: 'Checkout flow', order: 0 })
const starred = createSession({ name: 'Pricing page copy', order: 1 })
const worker = createSession({
  name: 'Launch checklist',
  order: 2,
  serves: ['launch#n1', 'team'],
})
const main = createWorktree(web.id, {
  name: 'main',
  path: '/tmp/e2e-acme-web',
  sessions: [pinned, starred, worker],
})

function graph(extra: Record<string, unknown>) {
  return {
    graphType: 'roadmap',
    locationKind: 'project-repo',
    branch: 'main',
    defaultBranch: 'main',
    offDefaultBranch: false,
    missing: false,
    error: null,
    nodeCount: 4,
    unseenChanges: 0,
    openRequests: 0,
    ...extra,
  }
}

const graphs = [
  graph({
    id: 'roadmap',
    title: 'Web roadmap',
    path: '/tmp/e2e-acme-web/.splitkick/graphs/roadmap.yml',
    repoRoot: '/tmp/e2e-acme-web',
    projectId: web.id,
    projectName: web.name,
    openRequests: 1,
  }),
  graph({
    id: 'bugs',
    title: 'Bug triage',
    graphType: 'backlog',
    path: '/tmp/e2e-acme-web/.splitkick/graphs/bugs.yml',
    repoRoot: '/tmp/e2e-acme-web',
    projectId: web.id,
    projectName: web.name,
    unseenChanges: 3,
  }),
  graph({
    id: 'launch',
    title: 'Docs launch',
    graphType: 'release',
    path: '/tmp/e2e-acme-docs/.splitkick/graphs/launch.yml',
    repoRoot: '/tmp/e2e-acme-docs',
    projectId: docs.id,
    projectName: docs.name,
  }),
  graph({
    id: 'team',
    title: 'Team goals',
    graphType: 'goals',
    locationKind: 'folder',
    path: '~/Splitkick/graphs/team.yml',
    repoRoot: null,
    projectId: null,
    projectName: null,
    branch: null,
    defaultBranch: null,
  }),
  graph({
    id: 'other',
    title: 'Unrelated plan',
    path: '/tmp/e2e-acme-docs/.splitkick/graphs/other.yml',
    repoRoot: '/tmp/e2e-acme-docs',
    projectId: docs.id,
    projectName: docs.name,
  }),
]

test.use({
  viewport: { width: 1280, height: 760 },
  responseOverrides: {
    // The shared mock has zoom_level 1.0, which the app clamps to 50 %.
    load_preferences: { ...mockPreferences, zoom_level: 100 },
    list_projects: [web, docs],
    list_worktrees: [main],
    list_graphs: graphs,
    list_graph_requests: [],
    load_ui_state: {
      ...mockUIState,
      active_project_id: null,
      expanded_project_ids: [web.id],
      expanded_pinned_project_ids: [web.id],
      expanded_graphs_project_ids: [web.id],
      project_canvas_settings: {
        [web.id]: {
          pinned_sessions: [{ session_id: pinned.id, worktree_id: main.id }],
        },
      },
      starred_sessions: [
        {
          project_id: web.id,
          worktree_id: main.id,
          session_id: starred.id,
        },
      ],
    },
  },
})

test.describe('Project Graphs row (#99)', () => {
  test('lists stored then served graphs and highlights the open one', async ({
    mockPage,
  }) => {
    await ensureSidebarOpen(mockPage)
    const panel = sidebar(mockPage)
    const section = panel.getByTestId('project-graphs-section')
    await expect(section).toBeVisible()
    await expect(panel.getByTestId('pinned-sessions-section')).toBeVisible()

    const ids = await section
      .locator('[data-testid^="project-graph-row-"]')
      .evaluateAll(els => els.map(el => el.getAttribute('data-testid')))
    expect(ids).toEqual([
      'project-graph-row-bugs',
      'project-graph-row-roadmap',
      'project-graph-row-launch',
      'project-graph-row-team',
    ])
    await expect(section.getByTestId('project-graph-row-launch')).toContainText(
      'from acme-docs'
    )

    await section.getByTestId('project-graph-row-roadmap').click()
    await expect(
      panel.getByTestId('project-graph-row-roadmap')
    ).toHaveAttribute('aria-current', 'page')

    const dir = process.env.SIDEBAR_SCREENSHOT_DIR
    if (dir) {
      const stamp = process.env.SIDEBAR_SCREENSHOT_STAMP ?? 'now'
      await mockPage.mouse.move(900, 600)
      // Let the sidebar slide-in and the stylesheet settle.
      await mockPage.waitForTimeout(1500)
      await panel.screenshot({
        path: `${dir}/project-graphs-light-${stamp}.png`,
      })
      await mockPage.evaluate(() => {
        document.documentElement.classList.remove('light')
        document.documentElement.classList.add('dark')
      })
      await mockPage.waitForTimeout(500)
      await panel.screenshot({
        path: `${dir}/project-graphs-dark-${stamp}.png`,
      })
    }
  })
})

test.describe('Project Graphs on a phone (#99)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true })

  test('the project view lists the graphs under Pinned', async ({
    mockPage,
  }) => {
    await mockPage.addStyleTag({
      content: '.tsqd-parent-container { display: none !important; }',
    })
    await mockPage.getByTestId('mobile-home-segment-projects').click()
    await mockPage
      .getByTestId('mobile-home-projects')
      .getByRole('button', { name: 'acme-web' })
      .click()

    const section = mockPage.getByTestId('project-graphs-section')
    await expect(section).toBeVisible()
    const ids = await section
      .locator('[data-testid^="project-graph-row-"]')
      .evaluateAll(els => els.map(el => el.getAttribute('data-testid')))
    expect(ids).toEqual([
      'project-graph-row-bugs',
      'project-graph-row-roadmap',
      'project-graph-row-launch',
      'project-graph-row-team',
    ])

    const dir = process.env.SIDEBAR_SCREENSHOT_DIR
    if (dir) {
      const stamp = process.env.SIDEBAR_SCREENSHOT_STAMP ?? 'now'
      await mockPage.waitForTimeout(1500)
      await mockPage.screenshot({
        path: `${dir}/project-graphs-phone-light-${stamp}.png`,
      })
      await mockPage.evaluate(() => {
        document.documentElement.classList.remove('light')
        document.documentElement.classList.add('dark')
      })
      await mockPage.waitForTimeout(500)
      await mockPage.screenshot({
        path: `${dir}/project-graphs-phone-dark-${stamp}.png`,
      })
    }

    await section.getByTestId('project-graph-row-launch').click()
    await expect(section).toHaveCount(0)
  })
})
