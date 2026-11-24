import type { Locator, Page } from '@playwright/test'
import {
  test,
  expect,
  asDesktopApp,
  ensureSidebarOpen,
} from '../fixtures/tauri-mock'
import {
  createProject,
  mockPreferences,
  mockUIState,
} from '../fixtures/mock-data'

/**
 * The Projects tree: a flat root (no "Folders" / "Projects" header rows) and
 * drag and drop between the root and a folder. Sample data only.
 */

const folder = createProject({
  name: 'Clients',
  path: '',
  is_folder: true,
  order: 0,
})
const acme = createProject({
  name: 'Acme Web',
  path: '/tmp/e2e-tree/acme-web',
  parent_id: folder.id,
  order: 0,
})
const docs = createProject({
  name: 'Docs site',
  path: '/tmp/e2e-tree/docs-site',
  parent_id: folder.id,
  order: 1,
})
const mobile = createProject({
  name: 'Mobile app',
  path: '/tmp/e2e-tree/mobile-app',
  order: 1,
})
const tools = createProject({
  name: 'Tools',
  path: '/tmp/e2e-tree/tools',
  order: 2,
})
const projects = [folder, acme, docs, mobile, tools]

test.use({
  viewport: { width: 1280, height: 720 },
  responseOverrides: {
    list_projects: projects,
    list_worktrees: [],
    load_preferences: {
      ...mockPreferences,
      zoom_level: 100,
      has_seen_feature_tour: true,
    },
    load_ui_state: {
      ...mockUIState,
      active_project_id: null,
      expanded_project_ids: [],
      expanded_folder_ids: [folder.id],
      sidebar_tab: 'projects',
    },
  },
})

const shotDir = process.env.PROJECT_TREE_SCREENSHOT_DIR
const shotStamp = process.env.PROJECT_TREE_SCREENSHOT_STAMP ?? 'shot'

async function shot(page: Page, name: string) {
  if (shotDir) {
    await page.screenshot({ path: `${shotDir}/${name}-${shotStamp}.png` })
  }
}

/**
 * A stateful projects backend in the page: `list_projects` serves the list,
 * `move_item` and `reorder_items` change it the way the Rust commands do
 * (folders first, then by order) and are logged in `window.__treeWrites`.
 * Installed after the last page load: a reload would reset the mock.
 */
async function serveProjects(page: Page) {
  await page.evaluate(seed => {
    type Item = {
      id: string
      parent_id?: string
      order: number
      is_folder?: boolean
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    const items: Item[] = structuredClone(seed)
    const writes: { cmd: string; args: Record<string, unknown> }[] = []
    w.__treeWrites = writes
    const siblings = (parentId: string | undefined, exclude?: string) =>
      items
        .filter(p => p.parent_id === parentId && p.id !== exclude)
        .sort(
          (a, b) =>
            Number(Boolean(b.is_folder)) - Number(Boolean(a.is_folder)) ||
            a.order - b.order
        )
    const handlers = w.__JEAN_E2E_MOCK__.invokeHandlers
    handlers.list_projects = () => structuredClone(items)
    handlers.move_item = (args: {
      itemId: string
      newParentId?: string
      targetIndex?: number
    }) => {
      writes.push({ cmd: 'move_item', args })
      const item = items.find(p => p.id === args.itemId)!
      const list = siblings(args.newParentId, item.id)
      list.splice(args.targetIndex ?? list.length, 0, item)
      item.parent_id = args.newParentId ?? undefined
      list.forEach((p, i) => (p.order = i))
      return structuredClone(item)
    }
    handlers.reorder_items = (args: { itemIds: string[] }) => {
      writes.push({ cmd: 'reorder_items', args })
      args.itemIds.forEach((id, i) => {
        const item = items.find(p => p.id === id)
        if (item) item.order = i
      })
      return null
    }
  }, projects)
}

const treeWrites = (page: Page) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page.evaluate(() => (window as any).__treeWrites ?? [])

const projectRow = (page: Page, id: string) =>
  page.getByTestId(`project-row-${id}`)
const folderRow = (page: Page) => page.getByTestId(`folder-row-${folder.id}`)

/** Names of the tree rows, top to bottom; nested ones with a "  " prefix. */
async function treeRows(page: Page): Promise<string[]> {
  const rows = await page
    .getByTestId('sidebar-tree-items')
    .locator('[data-testid^="folder-row-"], [data-testid^="project-row-"]')
    .evaluateAll(elements =>
      elements.map(row => ({
        id: (row.getAttribute('data-testid') ?? '').replace(
          /^(folder|project)-row-/,
          ''
        ),
        nested: Boolean(row.closest('.sidebar-sticky-folder-children')),
      }))
    )
  return rows.map(
    ({ id, nested }) =>
      `${nested ? '  ' : ''}${projects.find(p => p.id === id)?.name ?? id}`
  )
}

async function box(locator: Locator) {
  const b = await locator.boundingBox()
  if (!b) throw new Error('element has no box')
  return b
}

/** Press on `source`, move a little to start the drag, then through
 *  `points`, and release at the last one. */
async function drag(
  page: Page,
  source: Locator,
  points: { x: number; y: number }[]
) {
  const from = await box(source)
  const x = from.x + from.width / 2
  const y = from.y + from.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y + 6, { steps: 3 })
  for (const point of points) {
    await page.mouse.move(point.x, point.y, { steps: 6 })
  }
  await page.mouse.up()
}

async function openTree(page: Page, desktop = false) {
  await serveProjects(page)
  // The desktop layout opens the panel from the vertical navigation.
  if (desktop) await page.getByTestId('vertical-nav-projects').first().click()
  else await ensureSidebarOpen(page)
  await expect(projectRow(page, acme.id)).toBeVisible({ timeout: 5000 })
}

test.describe('Projects tree', () => {
  test('lists folders and root projects without section header rows', async ({
    mockPage,
  }) => {
    await openTree(mockPage)

    await expect(mockPage.getByTestId('sidebar-folders-toggle')).toHaveCount(0)
    await expect(mockPage.getByTestId('sidebar-projects-toggle')).toHaveCount(0)
    expect(await treeRows(mockPage)).toEqual([
      'Clients',
      '  Acme Web',
      '  Docs site',
      'Mobile app',
      'Tools',
    ])

    // New project and New folder moved to the panel toolbar's + menu.
    await mockPage
      .getByTestId('projects-panel-toolbar')
      .getByRole('button', { name: 'New project or folder' })
      .click()
    await expect(
      mockPage.getByRole('menuitem', { name: 'New project' })
    ).toBeVisible()
    await expect(
      mockPage.getByRole('menuitem', { name: 'New folder' })
    ).toBeVisible()
    await mockPage.keyboard.press('Escape')

    // Web access has the vertical navigation too, with the same icon.
    await expect(
      mockPage
        .getByTestId('vertical-nav-projects')
        .first()
        .locator('svg.lucide-folder-open')
    ).toHaveCount(1)
    await shot(mockPage, 'project-tree-web')
  })

  test('shows the flat tree and the open-folder icon in the vertical navigation', async ({
    mockPage,
  }) => {
    await asDesktopApp(mockPage)
    await openTree(mockPage, true)

    await expect(
      mockPage
        .getByTestId('vertical-nav-projects')
        .locator('svg.lucide-folder-open')
    ).toHaveCount(1)
    expect(await treeRows(mockPage)).toEqual([
      'Clients',
      '  Acme Web',
      '  Docs site',
      'Mobile app',
      'Tools',
    ])
    await shot(mockPage, 'project-tree-desktop')
  })

  test('keeps the first project in its folder when it is dropped back in place', async ({
    mockPage,
  }) => {
    await openTree(mockPage)
    const row = projectRow(mockPage, acme.id)
    const rowBox = await box(row)
    const folderBox = await box(folderRow(mockPage))
    const x = rowBox.x + rowBox.width / 2

    // Wiggle up to the lower edge of the folder row and back onto itself.
    await drag(mockPage, row, [
      { x, y: rowBox.y + 4 },
      { x, y: folderBox.y + folderBox.height - 3 },
      { x, y: rowBox.y + rowBox.height / 2 },
    ])
    await mockPage.waitForTimeout(300)
    expect(await treeWrites(mockPage)).toEqual([])
    expect(await treeRows(mockPage)).toEqual([
      'Clients',
      '  Acme Web',
      '  Docs site',
      'Mobile app',
      'Tools',
    ])

    // Released over the lower part of its own folder's row: still in place.
    await drag(mockPage, row, [{ x, y: folderBox.y + folderBox.height - 3 }])
    await mockPage.waitForTimeout(300)
    expect(await treeWrites(mockPage)).toEqual([])
    expect(await treeRows(mockPage)).toContain('  Acme Web')
  })

  test('moves the first project out when it is dropped above the folder row', async ({
    mockPage,
  }) => {
    await openTree(mockPage)
    const folderBox = await box(folderRow(mockPage))

    await drag(mockPage, projectRow(mockPage, acme.id), [
      { x: folderBox.x + folderBox.width / 2, y: folderBox.y + 3 },
    ])

    await expect
      .poll(() => treeWrites(mockPage))
      .toEqual([
        {
          cmd: 'move_item',
          args: { itemId: acme.id, targetIndex: 0 },
        },
      ])
    // Folders stay first, so it lands at the top of the root projects.
    await expect
      .poll(() => treeRows(mockPage))
      .toEqual(['Clients', '  Docs site', 'Acme Web', 'Mobile app', 'Tools'])
  })

  test('moves a root project into the folder and reorders the root', async ({
    mockPage,
  }) => {
    await openTree(mockPage)
    const toolsBox = await box(projectRow(mockPage, tools.id))

    // Reorder at the root: Mobile app below Tools.
    await drag(mockPage, projectRow(mockPage, mobile.id), [
      {
        x: toolsBox.x + toolsBox.width / 2,
        y: toolsBox.y + toolsBox.height * 0.85,
      },
    ])
    await expect
      .poll(() => treeRows(mockPage))
      .toEqual(['Clients', '  Acme Web', '  Docs site', 'Tools', 'Mobile app'])

    // Into the folder: the middle of its row.
    const folderBox = await box(folderRow(mockPage))
    await drag(mockPage, projectRow(mockPage, tools.id), [
      {
        x: folderBox.x + folderBox.width / 2,
        y: folderBox.y + folderBox.height / 2,
      },
    ])
    await expect
      .poll(() => treeRows(mockPage))
      .toEqual([
        'Clients',
        '  Acme Web',
        '  Docs site',
        '  Tools',
        'Mobile app',
      ])
  })
})
