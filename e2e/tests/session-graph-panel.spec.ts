import { test, expect, MOD, activateWorktree } from '../fixtures/tauri-mock'
import { defaultResponses } from '../fixtures/invoke-handlers'
import { createSession, mockUIState } from '../fixtures/mock-data'

// Issue #84: the session graph panel opens from the session window, the full
// chat view, the command palette (⌘K) and Mod+Shift+G.
const fuzzyTiger = (
  defaultResponses.list_worktrees as Record<string, unknown>[]
)[0]
const calmDolphin = (
  defaultResponses.list_worktrees as Record<string, unknown>[]
)[1]
const worker = createSession({
  id: 'worker',
  name: 'Worker',
  serves: ['g1#n1'],
})
const plain = createSession({ id: 'plain', name: 'Plain', order: 1 })

const graphSummary = {
  id: 'g1',
  title: 'Splitkick roadmap',
  graphType: 'roadmap',
  path: '/tmp/e2e-test-project/.splitkick/graphs/roadmap.yml',
  locationKind: 'project-repo',
  repoRoot: '/tmp/e2e-test-project',
  projectId: fuzzyTiger?.project_id,
  projectName: 'Test Project',
  branch: 'main',
  defaultBranch: 'main',
  offDefaultBranch: false,
  missing: false,
  error: null,
  nodeCount: 2,
  unseenChanges: 0,
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

function overrides(sessions: Record<string, unknown>[]) {
  return {
    get_worktree: fuzzyTiger,
    list_worktrees: [{ ...fuzzyTiger, sessions }, calmDolphin],
    list_graphs: [graphSummary],
    get_graph: {
      summary: graphSummary,
      nodes: [
        graphNode('n0', 'Graph layer'),
        graphNode('n1', 'Open the graph panel from anywhere', {
          description: 'Chat view button, ⌘K command and a shortcut.',
          relations: [{ kind: 'part-of', target: 'n0' }],
        }),
      ],
      derived: { n0: derived, n1: derived },
      incoming: {},
      external: {},
      graphServing: [],
    },
    list_graph_changes: [],
    list_graph_requests: [],
    // The narrow chat column (panel open) shows the mobile settings menu,
    // which lists the ports and the loaded contexts.
    get_ports: [],
    get_terminal_listening_ports: [],
    list_loaded_issue_contexts: [],
    list_loaded_pr_contexts: [],
    list_loaded_security_contexts: [],
    list_loaded_advisory_contexts: [],
    list_loaded_linear_issue_contexts: [],
    list_attached_saved_contexts: [],
  }
}

const panel = (page: import('@playwright/test').Page) =>
  page.getByTestId('session-graph-panel')

test.describe('Session graph panel entry points', () => {
  test.describe('linked session', () => {
    test.use({ responseOverrides: overrides([worker]) })

    test('header button in the session window', async ({ mockPage }) => {
      await activateWorktree(mockPage, 'fuzzy-tiger')
      const toolbar = mockPage.getByTestId('window-toolbar')
      await toolbar.getByRole('button', { name: 'Toggle graph panel' }).click()
      await expect(panel(mockPage)).toBeVisible()
    })

    test('command palette toggles the panel', async ({ mockPage }) => {
      await activateWorktree(mockPage, 'fuzzy-tiger')
      await mockPage.keyboard.press(`${MOD}+k`)
      await mockPage.locator('[cmdk-input]').fill('Toggle Graph Panel')
      await expect(
        mockPage.getByRole('option', { name: /Toggle Graph Panel/ })
      ).toBeVisible()
      await mockPage.keyboard.press('Enter')
      await expect(panel(mockPage)).toBeVisible()
    })

    test('Mod+Shift+G toggles the panel', async ({ mockPage }) => {
      await activateWorktree(mockPage, 'fuzzy-tiger')
      await mockPage.keyboard.press(`${MOD}+Shift+g`)
      await expect(panel(mockPage)).toBeVisible()
      await mockPage.keyboard.press(`${MOD}+Shift+g`)
      await expect(panel(mockPage)).toBeHidden()
    })
  })

  test.describe('full chat view', () => {
    test.use({
      responseOverrides: {
        ...overrides([worker]),
        load_ui_state: {
          ...mockUIState,
          active_project_id: fuzzyTiger?.project_id,
          expanded_project_ids: [fuzzyTiger?.project_id],
          active_worktree_id: fuzzyTiger?.id,
          active_worktree_path: fuzzyTiger?.path,
          active_session_ids: { [fuzzyTiger?.id as string]: 'worker' },
        },
      },
    })

    test('has the Graph button in the window toolbar', async ({ mockPage }) => {
      const toolbar = mockPage.getByTestId('window-toolbar')
      const button = toolbar.getByRole('button', {
        name: 'Toggle graph panel',
      })
      await expect(button).toBeVisible({ timeout: 5000 })
      // The window title stays: the chat view only adds the button.
      await expect(toolbar).toContainText('fuzzy-tiger')
      await button.click()
      await expect(panel(mockPage)).toBeVisible()
    })
  })

  test.describe('unlinked session', () => {
    test.use({ responseOverrides: overrides([plain]) })

    test('has no button; the command explains the link', async ({
      mockPage,
    }) => {
      await activateWorktree(mockPage, 'fuzzy-tiger')
      await expect(
        mockPage.getByRole('button', { name: 'Toggle graph panel' })
      ).toHaveCount(0)

      await mockPage.keyboard.press(`${MOD}+k`)
      await mockPage.locator('[cmdk-input]').fill('Toggle Graph Panel')
      await mockPage.keyboard.press('Enter')

      await expect(
        mockPage.getByText('This session does not serve a graph node yet.')
      ).toBeVisible()
      await expect(panel(mockPage)).toHaveCount(0)
    })
  })
})
