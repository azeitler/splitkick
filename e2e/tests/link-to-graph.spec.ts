import type { Locator, Page } from '@playwright/test'
import { test, expect, MOD, activateWorktree } from '../fixtures/tauri-mock'
import { defaultResponses } from '../fixtures/invoke-handlers'
import { createSession } from '../fixtures/mock-data'

// Issue #88: "Link to Graph…" for every session, from the session context
// menu and ⌘K; a manager's serves change shows in the graph's Review tab.
const fuzzyTiger = (
  defaultResponses.list_worktrees as Record<string, unknown>[]
)[0]
const calmDolphin = (
  defaultResponses.list_worktrees as Record<string, unknown>[]
)[1]
const plain = createSession({ id: 'plain', name: 'Windows installer' })

const graphSummary = {
  id: 'g1',
  title: 'Release 1.6',
  graphType: 'release',
  path: '/tmp/e2e-test-project/.splitkick/graphs/release-1-6.yml',
  locationKind: 'project-repo',
  repoRoot: '/tmp/e2e-test-project',
  projectId: fuzzyTiger?.project_id,
  projectName: 'Test Project',
  branch: 'main',
  defaultBranch: 'main',
  offDefaultBranch: false,
  missing: false,
  error: null,
  nodeCount: 3,
  unseenChanges: 1,
  openRequests: 0,
}
const graphNode = (id: string, title: string, extra = {}) => ({
  id,
  title,
  description: '',
  state: 'committed',
  properties: [],
  relations: [],
  attachments: [],
  ...extra,
})
const derived = {
  active: false,
  blocked: false,
  blockers: [],
  progressDone: 0,
  progressTotal: 0,
  serving: [],
}

const servesChange = {
  id: 'c1',
  graphId: 'g1',
  nodeId: null,
  at: Date.now() - 4 * 60_000,
  actor: {
    kind: 'session',
    sessionId: 'mgr',
    sessionName: 'Release orchestrator',
    agentId: null,
  },
  action: 'session.serves',
  summary: 'Session "Windows installer" linked to Windows build',
  why: 'The installer work belongs to the Windows build node.',
  before: null,
  after: null,
  revertedBy: null,
  seen: false,
  serves: {
    sessionId: 'plain',
    sessionName: 'Windows installer',
    added: ['g1#n1'],
    removed: [],
  },
}

test.use({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  responseOverrides: {
    get_worktree: fuzzyTiger,
    list_worktrees: [{ ...fuzzyTiger, sessions: [plain] }, calmDolphin],
    list_graphs: [graphSummary],
    get_graph: {
      summary: graphSummary,
      nodes: [
        graphNode('n0', 'Release 1.6'),
        graphNode('n1', 'Windows build', {
          relations: [{ kind: 'part-of', target: 'n0' }],
        }),
        graphNode('n2', 'Release notes', {
          relations: [{ kind: 'part-of', target: 'n0' }],
        }),
      ],
      derived: { n0: derived, n1: derived, n2: derived },
      incoming: {},
      external: {},
      graphServing: [],
    },
    list_graph_changes: [servesChange],
    list_graph_requests: [],
    change_session_serves: ['g1#n1'],
    // The chat toolbar's settings menu lists ports and loaded contexts.
    get_ports: [],
    get_terminal_listening_ports: [],
    list_loaded_issue_contexts: [],
    list_loaded_pr_contexts: [],
    list_loaded_security_contexts: [],
    list_loaded_advisory_contexts: [],
    list_loaded_linear_issue_contexts: [],
    list_attached_saved_contexts: [],
  },
})

const shotDir = process.env.LINK_TO_GRAPH_SCREENSHOT_DIR
const shotStamp = process.env.LINK_TO_GRAPH_SCREENSHOT_STAMP ?? 'shot'

async function shot(
  target: Page | Locator,
  name: string,
  clip?: { x: number; y: number; width: number; height: number }
) {
  if (shotDir) {
    const path = `${shotDir}/${name}-${shotStamp}.png`
    await (clip
      ? (target as Page).screenshot({ path, clip })
      : target.screenshot({ path }))
  }
}

const dialog = (page: Page) =>
  page.getByRole('dialog', { name: 'Link to Graph' })

test.describe('Link to Graph… (#88)', () => {
  test('session tab menu opens the picker and adds a node link', async ({
    mockPage,
  }) => {
    await activateWorktree(mockPage, 'fuzzy-tiger')
    await mockPage
      .getByText('Windows installer', { exact: true })
      .first()
      .click({ button: 'right' })
    const item = mockPage.getByRole('menuitem', { name: 'Link to Graph…' })
    await expect(item).toBeVisible()
    // Let the menu finish its fade-in.
    await mockPage.waitForTimeout(400)
    await shot(mockPage, 'link-to-graph-menu', {
      x: 0,
      y: 0,
      width: 760,
      height: 460,
    })
    await item.click()

    const picker = dialog(mockPage)
    await expect(picker).toBeVisible()
    await expect(picker).toContainText('Not linked to a graph yet.')
    await picker.getByRole('button', { name: 'Add' }).click()
    await picker.getByLabel('Serves graph').selectOption('g1')
    await picker.getByLabel('Serves node').selectOption('n1')
    await shot(picker, 'link-to-graph-picker')
    await picker.getByRole('button', { name: 'Add' }).click()

    await expect(picker).toContainText('Release 1.6 › Windows build')
    await shot(picker, 'link-to-graph-linked')
    await picker.getByRole('button', { name: 'Done' }).click()
    await expect(picker).toBeHidden()
  })

  test('command palette opens the picker', async ({ mockPage }) => {
    await activateWorktree(mockPage, 'fuzzy-tiger')
    await mockPage.keyboard.press(`${MOD}+k`)
    await mockPage.locator('[cmdk-input]').fill('Link to Graph')
    await expect(
      mockPage.getByRole('option', { name: /Link to Graph…/ })
    ).toBeVisible()
    await mockPage.waitForTimeout(300)
    await shot(mockPage, 'link-to-graph-palette', {
      x: 240,
      y: 0,
      width: 800,
      height: 460,
    })
    await mockPage.keyboard.press('Enter')
    await expect(dialog(mockPage)).toBeVisible()
  })

  test('a manager change shows in Review with its reason', async ({
    mockPage,
  }) => {
    await mockPage.evaluate(async () => {
      const mod = await import('/src/lib/graph-view.ts')
      mod.openGraphView('g1')
    })
    await mockPage.getByRole('tab', { name: /Review/ }).click()
    const row = mockPage.getByTestId('graph-change').first()
    await expect(row).toContainText(
      'Session "Windows installer" linked to Windows build'
    )
    await expect(row.getByRole('button', { name: /Revert/ })).toBeVisible()
    await shot(mockPage, 'link-to-graph-review', {
      x: 0,
      y: 0,
      width: 1280,
      height: 200,
    })
  })

  test('works on a phone', async ({ mockPage }) => {
    await mockPage.setViewportSize({ width: 390, height: 844 })
    await expect(mockPage.getByText('Loading Splitkick...')).toHaveCount(0, {
      timeout: 10_000,
    })
    await mockPage.evaluate(async () => {
      const mod = await import('/src/lib/link-to-graph.ts')
      mod.openLinkToGraph({
        id: 'plain',
        name: 'Windows installer',
        serves: ['g1#n1', 'g1'],
      })
    })
    const picker = dialog(mockPage)
    await expect(picker).toBeVisible()
    await expect(picker).toContainText('Release 1.6 (whole graph)')
    await mockPage.waitForTimeout(400)
    await shot(mockPage, 'link-to-graph-mobile')
  })
})
