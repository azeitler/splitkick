import { expect, test, type Locator, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { api, createSession, mcp, readEnv, waitForIdle } from '../helpers'
import { REPO_ROOT, type Instance } from '../launcher'
import { chatInput, goToSession, openApp, showSidebarTab } from './ui'

// Nodes, relations, attachments, derived values and the views of the graph
// layer (#79), end to end on instance A through the real web UI. Contract:
// docs/developer/graph-layer.md. Every UI write is checked in the YAML file
// on disk too. `/api/invoke`, the MCP socket and hand-written YAML files set
// up state the scenario is not about, or that no UI makes; each such call
// says so.

// Independent tests (unique names), run in file order by the one worker.

const SHOTS = join(REPO_ROOT, 'scratch/graph-e2e')

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

/** `<state>-YYYYMMDD-HHMMSS.png` under scratch/graph-e2e, stamped now. */
async function shot(page: Page, state: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: join(SHOTS, `${state}-${stamp()}.png`) })
}

/** Unique per test and per run: the instances are shared across spec files. */
function uid(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`
}

// ---------------------------------------------------------------------------
// Console errors: every test fails on an unexpected one.
// ---------------------------------------------------------------------------

/**
 * Console errors that are not about the graph layer: an open session asks
 * for the fixture repo's GitHub issues and PRs (no `gh` in the sealed home)
 * and its Sentry issues (none configured).
 */
const ALLOWED_CONSOLE: RegExp[] = [
  /Failed to load GitHub (PRs|issues)/,
  /Failed to load Sentry issues/,
]

let consoleErrors: string[] = []

test.beforeEach(({ page }) => {
  consoleErrors = []
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', error => consoleErrors.push(`pageerror: ${error}`))
})

/** Graphs registered by the test; unregistered after it (cleanup). */
const registered: string[] = []

test.afterEach(async () => {
  const { a } = readEnv()
  for (const id of registered.splice(0)) {
    await api(a, 'remove_graph', { graphId: id }).catch(() => undefined)
  }
  const unexpected = consoleErrors.filter(
    text => !ALLOWED_CONSOLE.some(re => re.test(text))
  )
  expect(unexpected, 'unexpected console errors').toEqual([])
})

// ---------------------------------------------------------------------------
// YAML on disk
// ---------------------------------------------------------------------------

interface YamlNode {
  id: string
  title: string
  state: string
  description: string
  properties: [string, string][]
  relations: [string, string][]
  attachments: [string, string][]
}

function unquote(value: string): string {
  const v = value.trim()
  if (v.startsWith("'") && v.endsWith("'")) {
    return v.slice(1, -1).replace(/''/g, "'")
  }
  if (v.startsWith('"') && v.endsWith('"')) return JSON.parse(v) as string
  return v
}

/** Reader for the graph files Splitkick writes (lists not indented). */
function readNodes(path: string): YamlNode[] {
  const nodes: YamlNode[] = []
  let current: YamlNode | null = null
  let section: string | null = null
  let inNodes = false
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line === 'nodes:') {
      inNodes = true
      continue
    }
    if (!inNodes) continue
    if (/^\S/.test(line) && !line.startsWith('- ')) {
      inNodes = false
      continue
    }
    let m = /^- id: (.*)$/.exec(line)
    if (m) {
      current = {
        id: unquote(m[1]!),
        title: '',
        state: 'proposed',
        description: '',
        properties: [],
        relations: [],
        attachments: [],
      }
      nodes.push(current)
      section = null
      continue
    }
    if (!current) continue
    m = /^ {2}(\w[\w-]*):\s*(.*)$/.exec(line)
    if (m) {
      const [, key, value] = m as unknown as [string, string, string]
      section = null
      if (key === 'title') current.title = unquote(value)
      else if (key === 'state') current.state = value.trim()
      else if (key === 'description') {
        if (value.startsWith('|')) section = 'description'
        else current.description = unquote(value)
      } else if (['properties', 'relations', 'attachments'].includes(key)) {
        section = key
      }
      continue
    }
    if (section === 'description' && line.startsWith('    ')) {
      current.description += (current.description ? '\n' : '') + line.slice(4)
      continue
    }
    m = /^ {4}([^:]+):\s*(.*)$/.exec(line)
    if (section === 'properties' && m) {
      current.properties.push([unquote(m[1]!), unquote(m[2]!)])
      continue
    }
    m = /^ {2}- ([^:]+):\s*(.*)$/.exec(line)
    if ((section === 'relations' || section === 'attachments') && m) {
      current[section].push([unquote(m[1]!), unquote(m[2]!)])
    }
  }
  return nodes
}

function yamlNode(path: string, title: string): YamlNode | undefined {
  return readNodes(path).find(n => n.title === title)
}

/** Wait until the YAML nodes on disk satisfy `check`. */
async function expectNodes(
  path: string,
  check: (nodes: YamlNode[]) => boolean,
  message?: string
) {
  await expect
    .poll(() => (existsSync(path) ? check(readNodes(path)) : false), {
      message,
    })
    .toBe(true)
}

/** Wait until node `title` on disk satisfies `check`. */
async function expectNode(
  path: string,
  title: string,
  check: (node: YamlNode) => boolean
) {
  await expectNodes(
    path,
    nodes => {
      const node = nodes.find(n => n.title === title)
      return !!node && check(node)
    },
    `node "${title}" in ${path}`
  )
}

interface FileNode {
  id: string
  title: string
  state?: string
  relations?: [string, string][]
  attachments?: [string, string][]
}

/** A graph file written by hand (outside Splitkick). */
function graphYaml(id: string, title: string, nodes: FileNode[]): string {
  const q = (text: string) => JSON.stringify(text)
  const lines = [`id: ${id}`, `title: ${q(title)}`, 'type: plan', 'nodes:']
  for (const node of nodes) {
    lines.push(`- id: ${node.id}`, `  title: ${q(node.title)}`)
    if (node.state) lines.push(`  state: ${node.state}`)
    for (const key of ['relations', 'attachments'] as const) {
      const list = node[key]
      if (!list?.length) continue
      lines.push(`  ${key}:`)
      for (const [k, v] of list) lines.push(`  - ${k}: ${q(v)}`)
    }
  }
  return lines.join('\n') + '\n'
}

interface Summary {
  id: string
  title: string
}

/** Setup only: a new, empty graph file in a folder, without the dialog. */
async function createGraph(
  a: Instance,
  title: string
): Promise<{
  id: string
  path: string
}> {
  const path = join(a.root, `gn-${uid()}`, 'graph.yml')
  const g = await api<Summary>(a, 'create_graph', {
    title,
    graphType: 'plan',
    path,
  })
  registered.push(g.id)
  return { id: g.id, path }
}

/**
 * Setup only: write a graph file by hand and register it. Opening an
 * existing file through the dialog is graphs-files.spec.ts's job.
 */
async function writeGraph(
  a: Instance,
  title: string,
  nodes: FileNode[]
): Promise<{ id: string; path: string }> {
  const id = randomUUID()
  const dir = join(a.root, `gn-${uid()}`)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'graph.yml')
  writeFileSync(path, graphYaml(id, title, nodes))
  await api(a, 'open_graph_file', { path })
  registered.push(id)
  return { id, path }
}

/** Setup only: add a node without the outline. */
const addNodeApi = (
  a: Instance,
  graphId: string,
  title: string,
  extra: Record<string, unknown> = {}
) =>
  api<{ id: string }>(a, 'create_graph_node', {
    graphId,
    node: { title, ...extra },
  })

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------

async function openWithSidebar(page: Page) {
  const { a } = readEnv()
  await openApp(page, a)
  const show = page.getByRole('button', { name: 'Show sidebar' })
  if (await show.isVisible()) await show.click()
  await showSidebarTab(page, 'graphs')
  await expect(page.getByTestId('sidebar-graphs-section')).toBeVisible()
}

const graphRow = (page: Page, id: string) =>
  page.getByTestId(`sidebar-graph-row-${id}`)

async function openGraph(page: Page, id: string, title: string) {
  await showSidebarTab(page, 'graphs')
  await graphRow(page, id).click()
  await expect(page.getByTestId('graph-title')).toHaveText(title)
}

const outline = (page: Page) => page.getByTestId('graph-outline')

/** The outline row whose title is exactly `title`. */
function nodeRow(page: Page, title: string): Locator {
  return outline(page)
    .locator('[data-testid^="graph-node-row-"]')
    .filter({ has: page.getByText(title, { exact: true }) })
}

const rowById = (page: Page, id: string) =>
  page.getByTestId(`graph-node-row-${id}`)

const detailPanel = (page: Page) => page.getByTestId('graph-node-detail')

/** Open a node's detail from its outline row. */
async function openNode(page: Page, title: string): Promise<Locator> {
  const detail = detailPanel(page)
  if (
    (await detail.isVisible()) &&
    (await detail.getByLabel('Node title').inputValue()) === title
  ) {
    return detail
  }
  await nodeRow(page, title).click()
  await expect(detail.getByLabel('Node title')).toHaveValue(title)
  return detail
}

async function addNode(page: Page, title: string, parent?: string) {
  const add = page.getByTestId('graph-add-node')
  if (!(await add.isVisible())) {
    await page.getByRole('button', { name: 'Add node' }).click()
  }
  await add
    .getByLabel('Parent node')
    .selectOption(parent ? { label: `Part of: ${parent}` } : { value: '' })
  await add.getByLabel('New node title').fill(title)
  await add.getByLabel('New node title').press('Enter')
  await expect(nodeRow(page, title)).toBeVisible()
}

/** Add a relation in the open node detail. */
async function addRelation(
  detail: Locator,
  kind: string,
  target: { node: string } | { text: string }
) {
  await detail.getByLabel('Relation kind').selectOption(kind)
  if ('node' in target) {
    await detail
      .getByLabel('Relation target', { exact: true })
      .selectOption({ label: target.node })
  } else {
    await detail
      .getByLabel('Relation target', { exact: true })
      .selectOption({ label: 'Other graph or decision…' })
    await detail.getByLabel('Relation target text').fill(target.text)
  }
  await detail.getByRole('button', { name: 'Add relation' }).click()
}

const relationRow = (detail: Locator, kind: string, title: string) =>
  detail
    .getByTestId('graph-relation')
    .filter({ hasText: kind })
    .filter({ hasText: title })

/** A computed incoming relation row in the detail ("needed by X"). */
const incomingRow = (detail: Locator, label: string, title: string) =>
  detail
    .getByTestId('graph-incoming')
    .locator('div')
    .filter({ hasText: label })
    .filter({ hasText: title })

const blockedBadge = (page: Page, id: string) =>
  rowById(page, id).getByTestId('node-blocked-badge')

// ---------------------------------------------------------------------------
// 1. Node CRUD in the Outline
// ---------------------------------------------------------------------------

test('outline: add root and nested nodes, rename, describe, delete, revert the delete', async ({
  page,
}) => {
  const { a } = readEnv()
  const title = `Nodes CRUD ${uid()}`
  const g = await createGraph(a, title) // setup

  await openWithSidebar(page)
  await openGraph(page, g.id, title)
  await expect(outline(page)).toContainText('No nodes yet.')

  // Root, then three nesting levels below it.
  await addNode(page, 'Root')
  await addNode(page, 'Child', 'Root')
  await addNode(page, 'Grandchild', 'Child')
  await addNode(page, 'Great-grandchild', 'Grandchild')
  await addNode(page, 'Doomed')
  for (const [name, depth] of [
    ['Root', '0'],
    ['Child', '1'],
    ['Grandchild', '2'],
    ['Great-grandchild', '3'],
    ['Doomed', '0'],
  ] as const) {
    await expect(nodeRow(page, name)).toHaveAttribute('data-depth', depth)
  }
  // A group root shows its progress, a child its state chip.
  await expect(nodeRow(page, 'Root').getByTestId('node-progress')).toHaveText(
    /0\/1 done/
  )
  await expect(
    nodeRow(page, 'Child').getByTestId('node-state-chip')
  ).toHaveText('proposed')

  await expectNodes(g.path, nodes => nodes.length === 5)
  const ids = Object.fromEntries(readNodes(g.path).map(n => [n.title, n.id]))
  expect(yamlNode(g.path, 'Root')!.relations).toEqual([])
  expect(yamlNode(g.path, 'Child')!.relations).toEqual([['part-of', ids.Root]])
  expect(yamlNode(g.path, 'Grandchild')!.relations).toEqual([
    ['part-of', ids.Child],
  ])
  expect(yamlNode(g.path, 'Great-grandchild')!.relations).toEqual([
    ['part-of', ids.Grandchild],
  ])
  for (const node of readNodes(g.path)) expect(node.id).toMatch(/^[a-z0-9]{6}$/)

  // Rename inline in the detail (Enter saves).
  let detail = await openNode(page, 'Child')
  await detail.getByLabel('Node title').fill('Child renamed')
  await detail.getByLabel('Node title').press('Enter')
  await expect(nodeRow(page, 'Child renamed')).toBeVisible()
  await expectNode(g.path, 'Child renamed', n => n.id === ids.Child)

  // Description saves on blur, not while typing.
  const description = detail.getByLabel('Description')
  await description.fill('First line\nSecond line')
  await page.waitForTimeout(500)
  expect(yamlNode(g.path, 'Child renamed')!.description).toBe('')
  await description.blur()
  await expectNode(
    g.path,
    'Child renamed',
    n => n.description === 'First line\nSecond line'
  )

  // Child depends on Doomed: the delete must remove that relation.
  await addRelation(detail, 'depends-on', { node: 'Doomed' })
  await expectNode(g.path, 'Child renamed', n =>
    n.relations.some(([k, v]) => k === 'depends-on' && v === ids.Doomed)
  )

  // Delete: Cancel keeps the node.
  detail = await openNode(page, 'Doomed')
  await detail.getByRole('button', { name: 'Delete node' }).click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toContainText('Delete “Doomed”?')
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  await expect(confirm).toBeHidden()
  await expect(nodeRow(page, 'Doomed')).toBeVisible()
  expect(yamlNode(g.path, 'Doomed')).toBeDefined()

  // Delete: confirm removes it and the same-graph relation to it.
  await detail.getByRole('button', { name: 'Delete node' }).click()
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(nodeRow(page, 'Doomed')).toHaveCount(0)
  await expect(detailPanel(page)).toBeHidden()
  await expectNodes(
    g.path,
    nodes =>
      !nodes.some(n => n.title === 'Doomed') &&
      nodes
        .find(n => n.title === 'Child renamed')!
        .relations.every(([, v]) => v !== ids.Doomed)
  )
  expect(yamlNode(g.path, 'Child renamed')!.relations).toEqual([
    ['part-of', ids.Root],
  ])

  // Review → Revert the delete: the node comes back at the end of the file.
  // The relation the delete removed from Child stays removed (documented).
  await page.getByTestId('graph-tab-review').click()
  const change = page
    .getByTestId('graph-review')
    .getByTestId('graph-change')
    .filter({ hasText: 'Deleted "Doomed"' })
  await expect(change).toContainText('You')
  await change.getByRole('button', { name: 'Revert' }).click()
  await expect(change.getByRole('button', { name: 'reverted' })).toBeDisabled()
  await expectNodes(g.path, nodes => nodes.at(-1)?.title === 'Doomed')
  expect(yamlNode(g.path, 'Doomed')!.id).toBe(ids.Doomed)
  expect(yamlNode(g.path, 'Child renamed')!.relations).toEqual([
    ['part-of', ids.Root],
  ])
  await page.getByTestId('graph-tab-outline').click()
  await expect(nodeRow(page, 'Doomed')).toBeVisible()
})

// ---------------------------------------------------------------------------
// 2. State transitions
// ---------------------------------------------------------------------------

test('state: proposed → committed → done → dropped → proposed in chip, glyph, style and YAML', async ({
  page,
}) => {
  const { a } = readEnv()
  const title = `States ${uid()}`
  const g = await createGraph(a, title) // setup
  await addNodeApi(a, g.id, 'Stateful') // setup

  await openWithSidebar(page)
  await openGraph(page, g.id, title)
  const detail = await openNode(page, 'Stateful')
  const row = nodeRow(page, 'Stateful')
  const titleText = row.getByText('Stateful', { exact: true })

  await expect(row.getByTestId('node-state-chip')).toHaveText('proposed')
  await expect(row.locator('svg[aria-label="proposed"]')).toBeVisible()
  await expect(titleText).not.toHaveClass(/text-muted-foreground/)

  for (const state of ['committed', 'done', 'dropped', 'proposed'] as const) {
    await detail.getByRole('radio', { name: state }).click()
    await expect(row.getByTestId('node-state-chip')).toHaveText(state)
    await expect(row.locator(`svg[aria-label="${state}"]`)).toBeVisible()
    await expect(
      detailPanel(page).locator('header').getByTestId('node-state-chip')
    ).toHaveText(state)
    await expect(detail.getByRole('radio', { name: state })).toHaveAttribute(
      'aria-checked',
      'true'
    )
    // done and dropped are dimmed; dropped is struck through.
    if (state === 'done' || state === 'dropped') {
      await expect(titleText).toHaveClass(/text-muted-foreground/)
    } else {
      await expect(titleText).not.toHaveClass(/text-muted-foreground/)
    }
    if (state === 'dropped') {
      await expect(row.getByTestId('node-state-chip')).toHaveClass(
        /line-through/
      )
    }
    await expectNode(g.path, 'Stateful', n => n.state === state)
    expect(readFileSync(g.path, 'utf8')).toContain(`\n  state: ${state}\n`)
  }
})

// ---------------------------------------------------------------------------
// 3. Properties
// ---------------------------------------------------------------------------

test('properties: add, edit value, replace by key, remove; order kept; empty key rejected', async ({
  page,
}) => {
  const { a } = readEnv()
  const title = `Properties ${uid()}`
  const g = await createGraph(a, title) // setup
  await addNodeApi(a, g.id, 'Props') // setup

  await openWithSidebar(page)
  await openGraph(page, g.id, title)
  const detail = await openNode(page, 'Props')
  const key = detail.getByLabel('New property key')
  const value = detail.getByLabel('New property value')
  const addButton = detail.getByRole('button', { name: 'Add property' })

  // Enter in the value field adds; so does the + button.
  await key.fill('quarter')
  await value.fill('2027-Q1')
  await value.press('Enter')
  await expect(
    detail.getByLabel('Property quarter', { exact: true })
  ).toHaveValue('2027-Q1')
  await key.fill('owner')
  await value.fill('ann')
  await addButton.click()
  await key.fill('size')
  await value.fill('L')
  await value.press('Enter')
  await expect(detail.getByLabel('Property size', { exact: true })).toHaveValue(
    'L'
  )
  await expectNode(g.path, 'Props', n =>
    sameList(n.properties, [
      ['quarter', '2027-Q1'],
      ['owner', 'ann'],
      ['size', 'L'],
    ])
  )

  // Edit a value (saved on blur): the order stays.
  await detail.getByLabel('Property owner', { exact: true }).fill('bob')
  await detail.getByLabel('Property owner', { exact: true }).blur()
  await expectNode(g.path, 'Props', n =>
    sameList(n.properties, [
      ['quarter', '2027-Q1'],
      ['owner', 'bob'],
      ['size', 'L'],
    ])
  )

  // A key is a label, not a field: the add row with an existing key
  // replaces that value in place (the way to change a key is remove + add).
  await expect(
    detail.getByLabel('Property quarter', { exact: true })
  ).toBeVisible()
  await key.fill('quarter')
  await value.fill('2027-Q2')
  await value.press('Enter')
  await expectNode(g.path, 'Props', n =>
    sameList(n.properties, [
      ['quarter', '2027-Q2'],
      ['owner', 'bob'],
      ['size', 'L'],
    ])
  )

  // Remove.
  await detail.getByRole('button', { name: 'Remove property quarter' }).click()
  await expect(
    detail.getByLabel('Property quarter', { exact: true })
  ).toHaveCount(0)
  await expectNode(g.path, 'Props', n =>
    sameList(n.properties, [
      ['owner', 'bob'],
      ['size', 'L'],
    ])
  )

  // Empty (or blank) key: the button is disabled and Enter does nothing.
  const before = readFileSync(g.path, 'utf8')
  await key.fill('   ')
  await value.fill('orphan')
  await expect(addButton).toBeDisabled()
  await value.press('Enter')
  await key.fill('')
  await expect(addButton).toBeDisabled()
  await value.press('Enter')
  await page.waitForTimeout(700)
  expect(readFileSync(g.path, 'utf8')).toBe(before)
  await expect(detail.getByLabel(/^Property /)).toHaveCount(2)
})

function sameList(actual: [string, string][], expected: [string, string][]) {
  return JSON.stringify(actual) === JSON.stringify(expected)
}

// ---------------------------------------------------------------------------
// 4. Relations
// ---------------------------------------------------------------------------

test('relations: each kind added and removed, incoming labels, part-of moves the node', async ({
  page,
}) => {
  const { a } = readEnv()
  const title = `Relations ${uid()}`
  const g = await createGraph(a, title) // setup
  for (const name of ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Group']) {
    await addNodeApi(a, g.id, name) // setup
  }
  const ids = Object.fromEntries(readNodes(g.path).map(n => [n.title, n.id]))

  await openWithSidebar(page)
  await openGraph(page, g.id, title)

  // Bravo: depends-on Alpha, blocked-by Charlie, blocked-by free text.
  let detail = await openNode(page, 'Bravo')
  await addRelation(detail, 'depends-on', { node: 'Alpha' })
  await expect(relationRow(detail, 'depends-on', 'Alpha')).toBeVisible()
  await addRelation(detail, 'blocked-by', { node: 'Charlie' })
  await expect(relationRow(detail, 'blocked-by', 'Charlie')).toBeVisible()
  // Free text is only allowed for blocked-by.
  await detail.getByLabel('Relation kind').selectOption('depends-on')
  await detail
    .getByLabel('Relation target', { exact: true })
    .selectOption({ label: 'Other graph or decision…' })
  await detail.getByLabel('Relation target text').fill('decision: free text')
  await expect(
    detail.getByRole('button', { name: 'Add relation' })
  ).toBeDisabled()
  await addRelation(detail, 'blocked-by', { text: 'decision: pick a db' })
  const decision = relationRow(detail, 'blocked-by', 'decision: pick a db')
  await expect(decision).toBeVisible()
  await expect(decision.locator('svg.text-red-500')).toBeVisible()
  await expect(blockedBadge(page, ids.Bravo)).toBeVisible()
  await expectNode(g.path, 'Bravo', n =>
    sameList(n.relations, [
      ['depends-on', ids.Alpha],
      ['blocked-by', ids.Charlie],
      ['blocked-by', 'decision: pick a db'],
    ])
  )

  // Delta: part-of Group moves it under Group in the outline.
  await expect(nodeRow(page, 'Delta')).toHaveAttribute('data-depth', '0')
  detail = await openNode(page, 'Delta')
  await addRelation(detail, 'part-of', { node: 'Group' })
  await expect(nodeRow(page, 'Delta')).toHaveAttribute('data-depth', '1')
  await expect(nodeRow(page, 'Group').getByTestId('node-progress')).toHaveText(
    /0\/1 done/
  )
  await expectNode(g.path, 'Delta', n =>
    sameList(n.relations, [['part-of', ids.Group]])
  )

  // Alpha relates-to Delta.
  detail = await openNode(page, 'Alpha')
  await addRelation(detail, 'relates-to', { node: 'Delta' })
  await expect(relationRow(detail, 'relates-to', 'Delta')).toBeVisible()
  await expectNode(g.path, 'Alpha', n =>
    sameList(n.relations, [['relates-to', ids.Delta]])
  )

  // Computed incoming relations on every target.
  await expect(incomingRow(detail, 'needed by', 'Bravo')).toBeVisible()
  detail = await openNode(page, 'Charlie')
  await expect(incomingRow(detail, 'blocks', 'Bravo')).toBeVisible()
  detail = await openNode(page, 'Group')
  await expect(incomingRow(detail, 'has part', 'Delta')).toBeVisible()
  detail = await openNode(page, 'Delta')
  await expect(incomingRow(detail, 'related from', 'Alpha')).toBeVisible()
  // Incoming relations are computed, never written.
  expect(yamlNode(g.path, 'Charlie')!.relations).toEqual([])
  expect(yamlNode(g.path, 'Group')!.relations).toEqual([])

  // Remove each kind through the UI.
  await detail.getByRole('button', { name: 'Remove part-of Group' }).click()
  await expect(nodeRow(page, 'Delta')).toHaveAttribute('data-depth', '0')
  await expectNode(g.path, 'Delta', n => n.relations.length === 0)

  detail = await openNode(page, 'Alpha')
  await detail.getByRole('button', { name: 'Remove relates-to Delta' }).click()
  await expectNode(g.path, 'Alpha', n => n.relations.length === 0)
  await expect(detail.getByTestId('graph-relation')).toHaveCount(0)

  detail = await openNode(page, 'Bravo')
  await detail.getByRole('button', { name: 'Remove depends-on Alpha' }).click()
  await expectNode(g.path, 'Bravo', n => n.relations.length === 2)
  await detail
    .getByRole('button', { name: 'Remove blocked-by decision: pick a db' })
    .click()
  await expectNode(g.path, 'Bravo', n =>
    sameList(n.relations, [['blocked-by', ids.Charlie]])
  )
  await expect(blockedBadge(page, ids.Bravo)).toBeVisible()
  await detail
    .getByRole('button', { name: 'Remove blocked-by Charlie' })
    .click()
  await expectNode(g.path, 'Bravo', n => n.relations.length === 0)
  await expect(blockedBadge(page, ids.Bravo)).toBeHidden()
  // The incoming labels are gone with them.
  detail = await openNode(page, 'Alpha')
  await expect(detail.getByTestId('graph-incoming')).toHaveCount(0)
})

test('relations across graphs: external rows, incoming in the other graph, refs that are not found', async ({
  page,
}) => {
  const { a } = readEnv()
  const tag = uid()
  const homeTitle = `Cross home ${tag}`
  const otherTitle = `Cross other ${tag}`
  const g = await createGraph(a, homeTitle) // setup
  const h = await createGraph(a, otherTitle) // setup
  await addNodeApi(a, g.id, 'Local node') // setup
  const x = await addNodeApi(a, h.id, 'Remote node', { state: 'committed' }) // setup
  const remoteRef = `${h.id}#${x.id}`
  const missingNodeRef = `${h.id}#zzzzzz`
  const unknownGraphRef = `00000000-0000-4000-8000-000000000000#abcdef`

  await openWithSidebar(page)
  await openGraph(page, g.id, homeTitle)
  let detail = await openNode(page, 'Local node')
  await addRelation(detail, 'relates-to', { text: remoteRef })
  await addRelation(detail, 'depends-on', { text: missingNodeRef })
  await addRelation(detail, 'blocked-by', { text: unknownGraphRef })
  await expectNode(g.path, 'Local node', n =>
    sameList(n.relations, [
      ['relates-to', remoteRef],
      ['depends-on', missingNodeRef],
      ['blocked-by', unknownGraphRef],
    ])
  )

  // Detail: the external target with its graph, the missing ones marked.
  const remote = relationRow(detail, 'relates-to', 'Remote node')
  await expect(remote).toContainText(`↗ ${otherTitle}`)
  await expect(remote.getByTestId('graph-ref-not-found')).toHaveCount(0)
  const missingNode = relationRow(detail, 'depends-on', missingNodeRef)
  await expect(missingNode).toContainText(`↗ ${otherTitle}`)
  await expect(missingNode.getByTestId('graph-ref-not-found')).toBeVisible()
  const unknownGraph = relationRow(detail, 'blocked-by', unknownGraphRef)
  await expect(unknownGraph.getByTestId('graph-ref-not-found')).toBeVisible()

  // Derived: a depends-on that is not found does not block; a blocked-by
  // that is not found blocks with its raw text.
  await expect(detail).toContainText(
    `Derived blocked: blocked-by ${unknownGraphRef}`
  )
  await expect(detail).not.toContainText(`depends-on ${missingNodeRef}`)

  // Outline: dashed rows under the node.
  const externalRows = outline(page).getByTestId('graph-external-row')
  await expect(externalRows).toHaveCount(3)
  const remoteRow = externalRows.filter({ hasText: 'Remote node' })
  await expect(remoteRow).toContainText(`↗ ${otherTitle}`)
  await expect(remoteRow).toContainText('Local node relates to it')
  await expect(remoteRow.locator('svg[aria-label="committed"]')).toBeVisible()
  await expect(externalRows.filter({ hasText: missingNodeRef })).toContainText(
    'not found'
  )
  await expect(externalRows.filter({ hasText: unknownGraphRef })).toContainText(
    '↗ other graph'
  )
  await shot(page, 'cross-graph-rows')

  // The other graph computes the incoming relation on its node.
  await openGraph(page, h.id, otherTitle)
  const incomingExternal = outline(page)
    .getByTestId('graph-external-row')
    .filter({ hasText: 'Local node' })
  await expect(incomingExternal).toContainText(`↗ ${homeTitle}`)
  await expect(incomingExternal).toContainText('relates to Remote node')
  detail = await openNode(page, 'Remote node')
  const incoming = incomingRow(detail, 'related from', 'Local node')
  await expect(incoming).toContainText(`↗ ${homeTitle}`)
  expect(yamlNode(h.path, 'Remote node')!.relations).toEqual([])
  await shot(page, 'cross-graph-incoming')

  // Remove the cross-graph relation from the home graph: gone in both.
  await openGraph(page, g.id, homeTitle)
  detail = await openNode(page, 'Local node')
  await detail
    .getByRole('button', { name: 'Remove relates-to Remote node' })
    .click()
  await expectNode(g.path, 'Local node', n => n.relations.length === 2)
  await expect(outline(page).getByTestId('graph-external-row')).toHaveCount(2)
  await openGraph(page, h.id, otherTitle)
  await expect(outline(page).getByTestId('graph-external-row')).toHaveCount(0)
})

// ---------------------------------------------------------------------------
// 5. Attachments
// ---------------------------------------------------------------------------

test('attachments: every kind added and removed, links, unknown kinds survive', async ({
  page,
}) => {
  const { a } = readEnv()
  const title = `Attachments ${uid()}`
  const id = randomUUID()
  const dir = join(a.root, `gn-${uid()}`)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'graph.yml')
  // Setup by hand: unknown attachment kinds are only written outside.
  writeFileSync(
    path,
    graphYaml(id, title, [
      {
        id: 'att001',
        title: 'Attached',
        attachments: [
          ['figma', 'https://figma.example/file/1'],
          ['ticket', 'OPS-12'],
        ],
      },
    ])
  )
  await api(a, 'open_graph_file', { path }) // setup
  registered.push(id)

  await openWithSidebar(page)
  await openGraph(page, id, title)
  const detail = await openNode(page, 'Attached')
  const rows = detail.getByTestId('graph-attachment')

  // Unknown kinds show as written (a URL as a link, other text as text).
  await expect(rows.filter({ hasText: 'figma' }).locator('a')).toHaveAttribute(
    'href',
    'https://figma.example/file/1'
  )
  await expect(rows.filter({ hasText: 'ticket' })).toContainText('OPS-12')
  await expect(rows.filter({ hasText: 'ticket' }).locator('a')).toHaveCount(0)

  const all: [string, string][] = [
    ['issue', 'azeitler/splitkick#78'],
    ['pr', 'azeitler/splitkick#80'],
    ['milestone', 'v1.0'],
    ['link', 'https://example.com/doc'],
    ['file', 'docs/plan.md'],
    ['session', 'session-1234'],
    ['note', 'Runner stays out of v1.'],
  ]
  for (const [kind, value] of all) {
    await detail.getByLabel('Attachment kind').selectOption(kind)
    await detail.getByLabel('Attachment value').fill(value)
    if (kind === 'note')
      await detail.getByLabel('Attachment value').press('Enter')
    else await detail.getByRole('button', { name: 'Add attachment' }).click()
    await expect(rows.filter({ hasText: value })).toBeVisible()
  }
  await expectNode(path, 'Attached', n =>
    sameList(n.attachments, [
      ['figma', 'https://figma.example/file/1'],
      ['ticket', 'OPS-12'],
      ...all,
    ])
  )

  // issue, pr and link are links that open a new tab; the rest are text.
  const link = (value: string) =>
    rows.filter({ hasText: value }).getByRole('link', { name: value })
  await expect(link('azeitler/splitkick#78')).toHaveAttribute(
    'href',
    'https://github.com/azeitler/splitkick/issues/78'
  )
  await expect(link('azeitler/splitkick#80')).toHaveAttribute(
    'href',
    'https://github.com/azeitler/splitkick/pull/80'
  )
  await expect(link('https://example.com/doc')).toHaveAttribute(
    'href',
    'https://example.com/doc'
  )
  for (const value of [
    'azeitler/splitkick#78',
    'azeitler/splitkick#80',
    'https://example.com/doc',
  ]) {
    await expect(link(value)).toHaveAttribute('target', '_blank')
  }
  for (const value of ['v1.0', 'docs/plan.md', 'session-1234', 'Runner']) {
    await expect(rows.filter({ hasText: value }).locator('a')).toHaveCount(0)
  }
  // The outline row shows the issue number.
  await expect(nodeRow(page, 'Attached')).toContainText('#78')
  await shot(page, 'attachments')

  // Remove every known kind: the unknown ones stay in the file.
  for (const [kind, value] of all) {
    await detail
      .getByRole('button', { name: `Remove ${kind} ${value}` })
      .click()
    await expect(rows.filter({ hasText: value })).toHaveCount(0)
  }
  await expectNode(path, 'Attached', n =>
    sameList(n.attachments, [
      ['figma', 'https://figma.example/file/1'],
      ['ticket', 'OPS-12'],
    ])
  )
  await expect(nodeRow(page, 'Attached')).not.toContainText('#78')
})

// ---------------------------------------------------------------------------
// 6. Derived values
// ---------------------------------------------------------------------------

test('derived: blocked rules, progress over parts (also from another graph)', async ({
  page,
}) => {
  const { a } = readEnv()
  const tag = uid()
  const title = `Derived ${tag}`
  const otherTitle = `Derived other ${tag}`
  // Setup by hand: one node per rule, ids known in advance.
  const nodes: FileNode[] = [
    { id: 'tgopen', title: 'Target open', state: 'committed' },
    { id: 'tgdone', title: 'Target done', state: 'done' },
    { id: 'tgdrop', title: 'Target dropped', state: 'dropped' },
    {
      id: 'r1depo',
      title: 'Dep on open',
      relations: [['depends-on', 'tgopen']],
    },
    {
      id: 'r2depd',
      title: 'Dep on done',
      relations: [['depends-on', 'tgdone']],
    },
    {
      id: 'r3depx',
      title: 'Dep on dropped',
      relations: [['depends-on', 'tgdrop']],
    },
    {
      id: 'r4done',
      title: 'Done with open blocker',
      state: 'done',
      relations: [['depends-on', 'tgopen']],
    },
    {
      id: 'r5drop',
      title: 'Dropped with blocker',
      state: 'dropped',
      relations: [['blocked-by', 'tgopen']],
    },
    {
      id: 'r6text',
      title: 'Free text blocked',
      relations: [['blocked-by', 'decision: storage?']],
    },
    {
      id: 'r7bydn',
      title: 'Blocked by done',
      relations: [['blocked-by', 'tgdone']],
    },
    {
      id: 'r8depm',
      title: 'Dep on missing',
      relations: [['depends-on', 'zzzzz9']],
    },
    {
      id: 'r9bym',
      title: 'Blocked by missing',
      relations: [['blocked-by', 'qqqqq1']],
    },
    { id: 'grp001', title: 'Group' },
    {
      id: 'ch1don',
      title: 'Part done',
      state: 'done',
      relations: [['part-of', 'grp001']],
    },
    { id: 'ch2pro', title: 'Part open', relations: [['part-of', 'grp001']] },
    {
      id: 'ch3drp',
      title: 'Part dropped',
      state: 'dropped',
      relations: [['part-of', 'grp001']],
    },
    {
      id: 'ch4sub',
      title: 'Part with parts',
      state: 'committed',
      relations: [['part-of', 'grp001']],
    },
    {
      id: 'gc1don',
      title: 'Grandchild done',
      state: 'done',
      relations: [['part-of', 'ch4sub']],
    },
  ]
  const g = await writeGraph(a, title, nodes)
  // Another graph contributes a done part to Group.
  await writeGraph(a, otherTitle, [
    {
      id: 'xpart1',
      title: 'Remote part',
      state: 'done',
      relations: [['part-of', `${g.id}#grp001`]],
    },
  ])

  await openWithSidebar(page)
  await openGraph(page, g.id, title)

  const blocked = ['r1depo', 'r6text', 'r9bym']
  const notBlocked = [
    'r2depd',
    'r3depx',
    'r4done',
    'r5drop',
    'r7bydn',
    'r8depm',
    'tgopen',
  ]
  for (const id of blocked) await expect(blockedBadge(page, id)).toBeVisible()
  for (const id of notBlocked) {
    await expect(rowById(page, id)).toBeVisible()
    await expect(blockedBadge(page, id)).toHaveCount(0)
  }

  // The blocker text names what blocks.
  const expectBlockers = async (nodeTitle: string, text: string | null) => {
    const detail = await openNode(page, nodeTitle)
    if (text) await expect(detail).toContainText(`Derived blocked: ${text}`)
    else await expect(detail).not.toContainText('Derived blocked')
  }
  await expectBlockers('Dep on open', 'depends-on Target open')
  await expectBlockers('Free text blocked', 'blocked-by decision: storage?')
  await expectBlockers('Blocked by missing', 'blocked-by qqqqq1')
  await expectBlockers('Done with open blocker', null)
  await expectBlockers('Dropped with blocker', null)
  await expectBlockers('Dep on missing', null)

  // Progress: direct parts only (dropped excluded, done counted), plus the
  // part from the other graph. The grandchild counts for its own parent.
  await expect(rowById(page, 'grp001').getByTestId('node-progress')).toHaveText(
    /2\/4 done/
  )
  await expect(rowById(page, 'ch4sub').getByTestId('node-progress')).toHaveText(
    /1\/1 done/
  )
  const groupDetail = await openNode(page, 'Group')
  await expect(
    incomingRow(groupDetail, 'has part', 'Remote part')
  ).toContainText(`↗ ${otherTitle}`)

  // Dependencies bars carry the same derived values.
  await page.getByTestId('graph-tab-dependencies').click()
  const bar = (id: string) =>
    page.locator(`[data-testid="dependency-bar"][data-node-id="${id}"]`)
  for (const id of blocked) await expect(bar(id)).toContainText('blocked')
  for (const id of notBlocked) {
    await expect(bar(id)).toBeVisible()
    await expect(bar(id)).not.toContainText('blocked')
  }
  const groupLane = page
    .getByTestId('dependency-lane')
    .filter({ has: page.getByRole('button', { name: 'Group', exact: true }) })
  await expect(groupLane).toContainText('2/4 done')
  await page.getByTestId('graph-tab-outline').click()

  // The target becomes done in the UI: its dependent is no longer blocked.
  let detail = await openNode(page, 'Target open')
  await detail.getByRole('radio', { name: 'done' }).click()
  await expect(blockedBadge(page, 'r1depo')).toHaveCount(0)
  await expectNode(g.path, 'Target open', n => n.state === 'done')
  // ... and dropped does not block either.
  await detail.getByRole('radio', { name: 'dropped' }).click()
  await expectNode(g.path, 'Target open', n => n.state === 'dropped')
  await expect(blockedBadge(page, 'r1depo')).toHaveCount(0)
  // Back to open: blocked again; the dropped node with a blocker stays clear.
  await detail.getByRole('radio', { name: 'committed' }).click()
  await expect(blockedBadge(page, 'r1depo')).toBeVisible()
  await expect(blockedBadge(page, 'r5drop')).toHaveCount(0)
  await expect(blockedBadge(page, 'r4done')).toHaveCount(0)

  // A free-text blocker blocks until its relation is removed.
  detail = await openNode(page, 'Free text blocked')
  await detail
    .getByRole('button', { name: 'Remove blocked-by decision: storage?' })
    .click()
  await expect(blockedBadge(page, 'r6text')).toHaveCount(0)
  await expect(detail).not.toContainText('Derived blocked')
  await expectNode(g.path, 'Free text blocked', n => n.relations.length === 0)

  // A part changes state in the UI: the group's progress follows.
  detail = await openNode(page, 'Part open')
  await detail.getByRole('radio', { name: 'done' }).click()
  await expect(rowById(page, 'grp001').getByTestId('node-progress')).toHaveText(
    /3\/4 done/
  )
  await detail.getByRole('radio', { name: 'dropped' }).click()
  await expect(rowById(page, 'grp001').getByTestId('node-progress')).toHaveText(
    /2\/3 done/
  )
})

test('derived: active while a serving session runs', async ({ page }) => {
  const { a, alphaA } = readEnv()
  const tag = uid()
  const title = `Active ${tag}`
  const g = await createGraph(a, title) // setup
  const node = await addNodeApi(a, g.id, 'Served node') // setup
  await addNodeApi(a, g.id, 'Idle node') // setup
  const sessionName = `Serving ${tag}`
  const sessionId = await createSession(a, alphaA, sessionName) // setup
  // Which node a session serves is set in the session graph panel; that
  // panel is graphs.spec.ts's subject, so set it directly here.
  await api(a, 'set_session_serves', {
    sessionId,
    serves: [`${g.id}#${node.id}`],
  })

  await openWithSidebar(page)
  await openGraph(page, g.id, title)
  await expect(
    nodeRow(page, 'Served node').getByTestId('node-active-badge')
  ).toHaveCount(0)
  let detail = await openNode(page, 'Served node')
  await expect(
    detail.getByRole('button', { name: new RegExp(sessionName) })
  ).toContainText('idle')

  // A turn that keeps running (the stub sleeps) makes the node active.
  await goToSession(page, sessionName)
  await chatInput(page).fill('STUB:sleep 12000')
  await page.keyboard.press('Enter')
  await openGraph(page, g.id, title)
  await expect(
    nodeRow(page, 'Served node').getByTestId('node-active-badge')
  ).toBeVisible({ timeout: 10_000 })
  await expect(
    nodeRow(page, 'Idle node').getByTestId('node-active-badge')
  ).toHaveCount(0)
  detail = await openNode(page, 'Served node')
  await expect(
    detail.getByRole('button', { name: new RegExp(sessionName) })
  ).toContainText('running')
  await page.getByTestId('graph-tab-dependencies').click()
  await expect(
    page.locator(`[data-testid="dependency-bar"][data-node-id="${node.id}"]`)
  ).toContainText('active')
  await page.getByTestId('graph-tab-outline').click()

  // When the turn ends, the badge goes without a reload.
  await waitForIdle(a, sessionId)
  await expect(
    nodeRow(page, 'Served node').getByTestId('node-active-badge')
  ).toHaveCount(0, { timeout: 15_000 })
})

// ---------------------------------------------------------------------------
// 7. Dependencies view
// ---------------------------------------------------------------------------

const RED = '#ef4444'
const GREY = '#9ca3af'
const BLUE = '#3b82f6'
/** `colX` of GraphDependencies.tsx: LABEL_W + column × COL_W + 8. */
const colLeft = (column: number) => `${140 + column * 220 + 8}px`

test('dependencies: steps, lanes, decisions, edge colours, other graphs, click opens the node', async ({
  page,
}) => {
  const { a } = readEnv()
  const tag = uid()
  const title = `Deps ${tag}`
  const otherTitle = `Deps other ${tag}`
  const hid = randomUUID()
  // Setup by hand: the layout needs fixed ids and cross-graph refs.
  const g = await writeGraph(a, title, [
    { id: 'phase1', title: 'Phase' },
    {
      id: 'stepaa',
      title: 'Step A',
      state: 'done',
      relations: [['part-of', 'phase1']],
    },
    {
      id: 'stepbb',
      title: 'Step B',
      state: 'committed',
      relations: [
        ['part-of', 'phase1'],
        ['depends-on', 'stepaa'],
      ],
    },
    {
      id: 'stepcc',
      title: 'Step C',
      relations: [
        ['part-of', 'phase1'],
        ['depends-on', 'stepbb'],
      ],
    },
    {
      id: 'loose1',
      title: 'Loose decision',
      relations: [['blocked-by', 'decision: which vendor?']],
    },
    {
      id: 'cross1',
      title: 'Cross dep',
      relations: [['depends-on', `${hid}#extopn`]],
    },
  ])
  await writeGraphWithId(a, hid, otherTitle, [
    { id: 'extopn', title: 'Ext open', state: 'committed' },
    {
      id: 'extrel',
      title: 'Ext relater',
      relations: [['relates-to', `${g.id}#stepaa`]],
    },
  ])

  await openWithSidebar(page)
  await openGraph(page, g.id, title)
  await page.getByTestId('graph-tab-dependencies').click()
  const deps = page.getByTestId('graph-dependencies')
  const bar = (id: string) =>
    deps.locator(`[data-testid="dependency-bar"][data-node-id="${id}"]`)

  // Steps: the longest depends-on path. A chain of three → steps 1, 2, 3.
  for (const header of ['Open decisions', 'Step 1', 'Step 2', 'Step 3']) {
    await expect(deps.getByText(header, { exact: true })).toBeVisible()
  }
  await expect(bar('stepaa')).toHaveCSS('left', colLeft(1))
  await expect(bar('stepbb')).toHaveCSS('left', colLeft(2))
  await expect(bar('stepcc')).toHaveCSS('left', colLeft(3))
  await expect(bar('loose1')).toHaveCSS('left', colLeft(1))
  await expect(bar('cross1')).toHaveCSS('left', colLeft(1))
  // The group root is the lane header, not a bar.
  await expect(bar('phase1')).toHaveCount(0)

  // Lanes: the part-of group, "No group", "Other graphs".
  const lanes = deps.getByTestId('dependency-lane')
  await expect(lanes).toHaveCount(3)
  await expect(lanes.nth(0)).toContainText('Phase')
  await expect(lanes.nth(0)).toContainText('1/3 done')
  await expect(lanes.nth(1)).toContainText('No group')
  await expect(lanes.nth(2)).toContainText('Other graphs')
  const laneTop = async (index: number) =>
    parseFloat(await lanes.nth(index).evaluate(el => el.style.top))
  const barTop = async (id: string) =>
    parseFloat(await bar(id).evaluate(el => el.style.top))
  expect(await barTop('stepaa')).toBeGreaterThan(await laneTop(0))
  expect(await barTop('stepaa')).toBeLessThan(await laneTop(1))
  expect(await barTop('loose1')).toBeGreaterThan(await laneTop(1))
  expect(await barTop('loose1')).toBeLessThan(await laneTop(2))

  // The free-text blocker is a diamond in the "Open decisions" column.
  const decision = deps.getByTestId('dependency-decision')
  await expect(decision).toHaveCount(1)
  await expect(decision).toHaveText('decision: which vendor?')
  await expect(decision).toHaveCSS('left', colLeft(0))
  await expect(decision.locator('span.rotate-45')).toBeVisible()

  // Other graphs: dashed, not clickable, with the graph's name.
  const external = deps
    .getByTestId('dependency-bar')
    .and(deps.locator(':not([data-node-id])'))
  await expect(external).toHaveCount(2)
  for (const name of ['Ext open', 'Ext relater']) {
    const ext = external.filter({ hasText: name })
    await expect(ext).toContainText(otherTitle)
    await expect(ext).toHaveClass(/border-dashed/)
    await expect(ext).toBeDisabled()
    const top = parseFloat(await ext.evaluate(el => el.style.top))
    expect(top).toBeGreaterThan(await laneTop(2))
  }

  // Edges: red to a target that is not done, grey to a done one, blue for
  // relates-to. Step B → Step A (done): grey; Step C → Step B: red; Cross
  // dep → Ext open (not done): red; Ext relater → Step A: blue, dotted.
  const edges = (kind: string, stroke: string) =>
    deps.locator(
      `path[data-testid="dependency-edge-${kind}"][stroke="${stroke}"]`
    )
  await expect(edges('depends-on', GREY)).toHaveCount(1)
  await expect(edges('depends-on', RED)).toHaveCount(2)
  await expect(edges('relates-to', BLUE)).toHaveCount(1)
  await expect(edges('relates-to', BLUE)).toHaveAttribute(
    'stroke-dasharray',
    '2 3'
  )
  // The decision line is red and dashed.
  await expect(
    deps.locator(`svg path[stroke="${RED}"][stroke-dasharray="4 3"]`)
  ).toHaveCount(1)
  await shot(page, 'dependencies-decisions-other-graphs')

  // Step B done → the edge to Step C turns grey.
  await bar('stepbb').click()
  const detail = detailPanel(page)
  await expect(detail.getByLabel('Node title')).toHaveValue('Step B')
  await detail.getByRole('radio', { name: 'done' }).click()
  await expect(edges('depends-on', GREY)).toHaveCount(2)
  await expect(edges('depends-on', RED)).toHaveCount(1)
  await expectNode(g.path, 'Step B', n => n.state === 'done')
  await expect(bar('stepbb')).toHaveClass(/opacity-60/)

  // A click on another bar switches the detail.
  await bar('loose1').click()
  await expect(detail.getByLabel('Node title')).toHaveValue('Loose decision')
  await expect(bar('loose1')).toHaveClass(/ring-2/)
})

/** Setup only: like `writeGraph`, with a chosen graph id. */
async function writeGraphWithId(
  a: Instance,
  id: string,
  title: string,
  nodes: FileNode[]
) {
  const dir = join(a.root, `gn-${uid()}`)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'graph.yml')
  writeFileSync(path, graphYaml(id, title, nodes))
  await api(a, 'open_graph_file', { path })
  registered.push(id)
  return { id, path }
}

test('dependencies: an empty graph shows an empty state; a depends-on cycle renders', async ({
  page,
}) => {
  const { a } = readEnv()
  const tag = uid()
  const emptyTitle = `Empty ${tag}`
  const cycleTitle = `Cycle ${tag}`
  const empty = await createGraph(a, emptyTitle) // setup
  // Setup by hand: the UI cannot make a cycle (it is a file edit).
  const cycle = await writeGraph(a, cycleTitle, [
    { id: 'cyc001', title: 'Cycle one', relations: [['depends-on', 'cyc002']] },
    { id: 'cyc002', title: 'Cycle two', relations: [['depends-on', 'cyc001']] },
  ])

  await openWithSidebar(page)
  await openGraph(page, empty.id, emptyTitle)
  await page.getByTestId('graph-tab-dependencies').click()
  await expect(page.getByTestId('graph-dependencies')).toHaveText(
    'No nodes yet.'
  )

  await openGraph(page, cycle.id, cycleTitle)
  // Another graph opens on its Outline tab.
  await page.getByTestId('graph-tab-dependencies').click()
  const deps = page.getByTestId('graph-dependencies')
  await expect(deps.getByTestId('dependency-bar')).toHaveCount(2)
  // The cycle is broken at the node seen again: Cycle two is step 1 above
  // Cycle one, Cycle one is step 2 (file order decides which).
  const bar = (id: string) =>
    deps.locator(`[data-testid="dependency-bar"][data-node-id="${id}"]`)
  await expect(bar('cyc002')).toHaveCSS('left', colLeft(2))
  await expect(bar('cyc001')).toHaveCSS('left', colLeft(3))
  await expect(bar('cyc001')).toContainText('blocked')
  await expect(bar('cyc002')).toContainText('blocked')
  await page.getByTestId('graph-tab-outline').click()
  await expect(blockedBadge(page, 'cyc001')).toBeVisible()
  await expect(blockedBadge(page, 'cyc002')).toBeVisible()
})

// ---------------------------------------------------------------------------
// 8. Node history and seen
// ---------------------------------------------------------------------------

test('history: the node lists its changes with who, why and when; opening it marks them seen', async ({
  page,
}) => {
  const { a, alphaA } = readEnv()
  const tag = uid()
  const title = `History ${tag}`
  const g = await createGraph(a, title) // setup
  const node = await addNodeApi(a, g.id, 'History node') // setup
  const other = await addNodeApi(a, g.id, 'Other node') // setup

  // Unseen changes need another actor: an agent session through MCP (no UI
  // writes as a session).
  const agentName = `Historian ${tag}`
  const sessionId = await createSession(a, alphaA, agentName)
  await api(a, 'set_session_graph_permission', {
    sessionId,
    permission: 'write',
  })
  await mcp(a, sessionId, 'update_node', {
    graphId: g.id,
    nodeId: node.id,
    title: 'History node v2',
    why: 'E2E why: a clearer name',
  })
  await mcp(a, sessionId, 'update_node', {
    graphId: g.id,
    nodeId: node.id,
    description: 'Written by the agent',
    why: 'E2E why: describe it',
  })
  await mcp(a, sessionId, 'update_node', {
    graphId: g.id,
    nodeId: other.id,
    description: 'Also by the agent',
    why: 'E2E why: the other one',
  })
  expect(yamlNode(g.path, 'History node v2')!.description).toBe(
    'Written by the agent'
  )

  await openWithSidebar(page)
  const unseenCount = graphRow(page, g.id).getByTestId('sidebar-graph-unseen')
  await expect(unseenCount).toHaveText('3')
  await openGraph(page, g.id, title)
  await expect(
    nodeRow(page, 'History node v2').getByTestId('node-unseen-dot')
  ).toBeVisible()
  await expect(
    nodeRow(page, 'Other node').getByTestId('node-unseen-dot')
  ).toBeVisible()

  const detail = await openNode(page, 'History node v2')
  const history = detail.getByTestId('graph-node-history').locator('li')
  await expect(history).toHaveCount(3)
  // Newest first.
  await expect(history.nth(0)).toContainText('Updated "History node v2"')
  await expect(history.nth(0)).toContainText(agentName)
  await expect(history.nth(0)).toContainText('Why: E2E why: describe it')
  await expect(history.nth(1)).toContainText(
    'Renamed "History node" to "History node v2"'
  )
  await expect(history.nth(1)).toContainText(agentName)
  await expect(history.nth(1)).toContainText('Why: E2E why: a clearer name')
  await expect(history.nth(2)).toContainText('Created "History node"')
  await expect(history.nth(2)).toContainText('You')
  // Time ago, the full date and time in the tooltip.
  for (let i = 0; i < 3; i++) {
    const time = history.nth(i).locator('span[title]')
    await expect(time).toHaveText(/ago|just now|now/i)
    await expect(time).toHaveAttribute('title', /\d{1,2}:\d{2}/)
  }

  // Opening the node saw its two changes; the other node's one is left.
  await expect(
    nodeRow(page, 'History node v2').getByTestId('node-unseen-dot')
  ).toHaveCount(0)
  await expect(
    nodeRow(page, 'Other node').getByTestId('node-unseen-dot')
  ).toBeVisible()
  await expect(unseenCount).toHaveText('1')
  const changes = await api<{ nodeId: string; seen: boolean }[]>(
    a,
    'list_graph_changes',
    { graphId: g.id }
  )
  expect(changes.filter(c => !c.seen).map(c => c.nodeId)).toEqual([other.id])

  // A UI edit of the node shows as "You" in its history and stays seen.
  await detail.getByLabel('Description').fill('Edited by me')
  await detail.getByLabel('Description').blur()
  await expect(history).toHaveCount(4)
  await expect(history.nth(0)).toContainText('You')
  await expectNode(
    g.path,
    'History node v2',
    n => n.description === 'Edited by me'
  )
  await expect(unseenCount).toHaveText('1')

  await openNode(page, 'Other node')
  await expect(unseenCount).toHaveCount(0)
})

// ---------------------------------------------------------------------------
// 9. Large graph
// ---------------------------------------------------------------------------

test('a graph with 60 nodes renders outline and dependencies within seconds', async ({
  page,
}) => {
  const { a } = readEnv()
  const title = `Large ${uid()}`
  // Setup by hand: 6 groups of 9 parts, each part depends on the one before,
  // the first part of a group on the last part of the group before.
  const nodes: FileNode[] = []
  for (let gi = 0; gi < 6; gi++) {
    const group = `grp${gi}00`
    nodes.push({ id: group, title: `Group ${gi}` })
    for (let ci = 0; ci < 9; ci++) {
      const id = `n${gi}${ci}000`.slice(0, 6)
      const before =
        ci > 0
          ? `n${gi}${ci - 1}000`.slice(0, 6)
          : gi > 0
            ? `n${gi - 1}8000`.slice(0, 6)
            : null
      nodes.push({
        id,
        title: `Node ${gi}.${ci}`,
        state: (gi * 9 + ci) % 4 === 0 ? 'done' : 'committed',
        relations: [
          ['part-of', group],
          ...(before ? ([['depends-on', before]] as [string, string][]) : []),
        ],
      })
    }
  }
  expect(nodes).toHaveLength(60)
  const g = await writeGraph(a, title, nodes)

  await openWithSidebar(page)
  const started = Date.now()
  await openGraph(page, g.id, title)
  const rows = outline(page).locator('[data-testid^="graph-node-row-"]')
  await expect(rows).toHaveCount(60, { timeout: 5_000 })
  const outlineMs = Date.now() - started

  const depsStarted = Date.now()
  await page.getByTestId('graph-tab-dependencies').click()
  const bars = page.getByTestId('dependency-bar')
  await expect(bars).toHaveCount(54, { timeout: 5_000 })
  await expect(page.getByTestId('dependency-lane')).toHaveCount(6)
  const depsMs = Date.now() - depsStarted
  // The longest chain runs through all 54 parts.
  await expect(
    page.getByTestId('graph-dependencies').getByText('Step 54', { exact: true })
  ).toBeAttached()
  console.log(`60 nodes: outline ${outlineMs} ms, dependencies ${depsMs} ms`)
  expect(outlineMs).toBeLessThan(5_000)
  expect(depsMs).toBeLessThan(5_000)
})

// ---------------------------------------------------------------------------
// 10. Keyboard
// ---------------------------------------------------------------------------

test('keyboard: Enter adds a node; Escape cancels the add row and inline edits', async ({
  page,
}) => {
  const { a } = readEnv()
  const title = `Keyboard ${uid()}`
  const g = await createGraph(a, title) // setup

  await openWithSidebar(page)
  await openGraph(page, g.id, title)

  // Enter in the add input creates the node and keeps the row open.
  await page.getByRole('button', { name: 'Add node' }).click()
  const input = page.getByLabel('New node title')
  await expect(input).toBeFocused()
  await input.fill('Keyed node')
  await input.press('Enter')
  await expect(nodeRow(page, 'Keyed node')).toBeVisible()
  await expect(input).toHaveValue('')
  await expectNodes(g.path, nodes => nodes.some(n => n.title === 'Keyed node'))
  // A blank title does nothing.
  await input.fill('   ')
  await input.press('Enter')
  // Escape closes the add row without adding.
  await input.fill('Never added')
  await input.press('Escape')
  await expect(page.getByTestId('graph-add-node')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Add node' })).toBeVisible()
  await page.waitForTimeout(500)
  expect(readNodes(g.path).map(n => n.title)).toEqual(['Keyed node'])

  const detail = await openNode(page, 'Keyed node')
  await detail.getByLabel('New property key').fill('size')
  await detail.getByLabel('New property value').fill('M')
  await detail.getByLabel('New property value').press('Enter')
  await expectNode(g.path, 'Keyed node', n => n.properties.length === 1)
  const saved = readFileSync(g.path, 'utf8')

  // Escape in the title restores it; leaving the field then saves nothing.
  const titleField = detail.getByLabel('Node title')
  await titleField.fill('Changed title')
  await titleField.press('Escape')
  await expect(titleField).toHaveValue('Keyed node')
  await titleField.blur()

  // Escape in the description restores it.
  const description = detail.getByLabel('Description')
  await description.fill('Draft text')
  await description.press('Escape')
  await expect(description).toHaveValue('')
  await description.blur()

  // Escape in a property value restores it.
  const property = detail.getByLabel('Property size', { exact: true })
  await property.fill('XL')
  await property.press('Escape')
  await expect(property).toHaveValue('M')
  await property.blur()

  // Escape in the graph is not a way out of the detail.
  await expect(detail).toBeVisible()
  await page.waitForTimeout(700)
  expect(readFileSync(g.path, 'utf8')).toBe(saved)
  await expect(nodeRow(page, 'Keyed node')).toBeVisible()
})
