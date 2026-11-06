import type { Locator, Page } from '@playwright/test'
import { test, expect, sidebar } from '../fixtures/tauri-mock'
import {
  createProject,
  createSession,
  createWorktree,
  mockUIState,
} from '../fixtures/mock-data'

/**
 * #77: the session network. An orchestrating session started sessions in
 * other projects; one of those started another. The sidebar marks linked
 * sessions, and the context menu opens the tree in the left panel's Network
 * tab (#98).
 */

const orchestrator = createProject({ name: 'release-train', order: 0 })
const api = createProject({ name: 'api-service', order: 1 })
const website = createProject({ name: 'website', order: 2 })

const root = createSession({
  name: 'Plan release 1.5',
  backend: 'claude',
  last_run_status: 'running',
  last_run_execution_mode: 'build',
})
const fixLogin = createSession({
  name: 'Fix login timeout',
  backend: 'codex',
  started_by_session_id: root.id,
  last_run_status: 'running',
  waiting_for_input: true,
})
const docs = createSession({
  name: 'Write release notes',
  backend: 'claude',
  started_by_session_id: root.id,
  last_run_status: 'completed',
})
const proofread = createSession({
  name: 'Proofread release notes',
  backend: 'opencode',
  started_by_session_id: docs.id,
  last_run_status: 'crashed',
})
const spike = createSession({
  name: 'Old caching spike',
  backend: 'claude',
  started_by_session_id: root.id,
  archived_at: Math.floor(Date.now() / 1000) - 3600,
})
const lone = createSession({ name: 'Unrelated chat', order: 1 })

const rootTree = createWorktree(orchestrator.id, {
  name: 'main',
  sessions: [root, lone],
})
const apiTree = createWorktree(api.id, {
  name: 'fix-login',
  sessions: [fixLogin],
})
const siteTree = createWorktree(website.id, {
  name: 'release-notes',
  sessions: [docs, proofread, spike],
})

function entry(
  project: ReturnType<typeof createProject>,
  worktree: ReturnType<typeof createWorktree>
) {
  return {
    project_id: project.id,
    project_name: project.name,
    worktree_id: worktree.id,
    worktree_name: worktree.name,
    worktree_path: worktree.path,
    sessions: worktree.sessions,
  }
}

function node(
  session: ReturnType<typeof createSession>,
  parentId: string | null,
  project: ReturnType<typeof createProject>,
  worktree: ReturnType<typeof createWorktree>
) {
  return {
    session,
    parentId,
    projectId: project.id,
    projectName: project.name,
    worktreeId: worktree.id,
    worktreeName: worktree.name,
    worktreePath: worktree.path,
    worktreeArchived: false,
  }
}

test.use({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  responseOverrides: {
    list_projects: [orchestrator, api, website],
    list_worktrees: [rootTree, apiTree, siteTree],
    list_all_sessions: {
      entries: [
        entry(orchestrator, rootTree),
        entry(api, apiTree),
        entry(website, siteTree),
      ],
    },
    get_session_link: {
      sessionId: root.id,
      name: root.name,
      worktreeId: rootTree.id,
      projectId: orchestrator.id,
      archived: false,
      startedBySessionId: null,
    },
    get_session_network: {
      rootId: root.id,
      rootParentMissing: false,
      nodes: [
        node(root, null, orchestrator, rootTree),
        node(fixLogin, root.id, api, apiTree),
        node(docs, root.id, website, siteTree),
        node(proofread, docs.id, website, siteTree),
        node(spike, root.id, website, siteTree),
      ],
    },
    load_ui_state: {
      ...mockUIState,
      active_project_id: null,
      expanded_project_ids: [orchestrator.id],
      expanded_worktree_ids: [rootTree.id],
    },
  },
})

/** Drive the UI store through the dev server's module graph. */
async function setUIStore(page: Page, action: string, arg: unknown) {
  await page.evaluate(
    async ([name, value]) => {
      const mod = await import('/src/store/ui-store.ts')
      const state = mod.useUIStore.getState() as unknown as Record<
        string,
        (v: unknown) => void
      >
      state[name as string]?.(value)
    },
    [action, arg] as const
  )
}

const shotDir = process.env.SESSION_NETWORK_SCREENSHOT_DIR
const shotStamp = process.env.SESSION_NETWORK_SCREENSHOT_STAMP ?? 'shot'

async function shot(target: Page | Locator, name: string) {
  if (shotDir) {
    await target.screenshot({ path: `${shotDir}/${name}-${shotStamp}.png` })
  }
}

test.describe('Session network (#77)', () => {
  test('sidebar marks linked sessions and the menu opens the tree', async ({
    mockPage,
  }) => {
    // Ctrl+B does not open the sidebar in this harness on every platform.
    await setUIStore(mockPage, 'setLeftSidebarVisible', true)
    const panel = sidebar(mockPage)

    const rootRow = panel.locator(`[data-sidebar-row-id="session:${root.id}"]`)
    const loneRow = panel.locator(`[data-sidebar-row-id="session:${lone.id}"]`)
    await expect(rootRow).toBeVisible()
    await expect(
      rootRow.getByRole('img', { name: 'Part of a session network' })
    ).toBeVisible()
    await expect(
      loneRow.getByRole('img', { name: 'Part of a session network' })
    ).toHaveCount(0)
    await shot(panel, 'session-network-sidebar')

    await rootRow.click({ button: 'right' })
    await mockPage
      .getByRole('menuitem', { name: 'Show Session Network' })
      .click()

    const dialog = mockPage.getByTestId('context-panel')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('tab', { name: 'Network' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    const rows = dialog.getByRole('list', { name: 'Session network' })
    await expect(rows.getByRole('listitem')).toHaveCount(5)
    await expect(dialog).toContainText('api-service › fix-login')
    await expect(dialog).toContainText('Proofread release notes')
    await expect(dialog).toContainText('Archived')
    await expect(
      dialog.getByRole('button', { name: /Old caching spike/ })
    ).toBeDisabled()
    await shot(dialog, 'session-network-panel')

    // A click opens the session; the panel stays and marks it.
    await dialog.getByRole('button', { name: /Fix login timeout/ }).click()
    await expect(
      dialog.getByRole('button', { name: /Fix login timeout/ })
    ).toContainText('This session')

    // The child's chat names its parent and links back to the network.
    const banner = mockPage.getByText('Started by ‘').first()
    await expect(banner).toBeVisible()
    const bannerRow = banner.locator('xpath=..')
    if (shotDir) {
      const box = await bannerRow.boundingBox()
      if (box) {
        await mockPage.screenshot({
          path: `${shotDir}/session-network-banner-${shotStamp}.png`,
          clip: {
            x: Math.max(0, box.x - 24),
            y: Math.max(0, box.y - 72),
            width: box.width + 48,
            height: box.height + 160,
          },
        })
      }
    }
    // From another tab, the banner's Network link goes back to the tree.
    await dialog.getByRole('tab', { name: 'Files' }).click()
    await bannerRow.getByRole('button', { name: 'Network' }).click()
    await expect(dialog.getByRole('tab', { name: 'Network' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(rows.getByRole('listitem')).toHaveCount(5)
  })

  test('works on a phone', async ({ mockPage }) => {
    await mockPage.setViewportSize({ width: 390, height: 844 })
    // Phones have no right-click: open it through the store.
    await setUIStore(mockPage, 'setSessionNetworkSessionId', root.id)
    await setUIStore(mockPage, 'openContextPanel', 'network')
    const dialog = mockPage.getByTestId('mobile-file-browser')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('tab', { name: 'Network' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(dialog).toContainText('Plan release 1.5')
    await shot(mockPage, 'session-network-mobile')
  })
})
