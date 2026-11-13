import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { api, createRepo, createSession, git, mcp, readEnv } from '../helpers'
import { REPO_ROOT, type Instance } from '../launcher'
import { openApp, showSidebarTab } from './ui'

// Graph files, locations and the store (graph layer, #79), end to end on
// instance A through the real web UI. Contract: docs/developer/graph-layer.md.
// `/api/invoke` is used only to set up state the scenario is not about, or
// where no UI exists; each such call says so.

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

interface Summary {
  id: string
  title: string
  graphType: string
  path: string
  locationKind: string
  repoRoot: string | null
  branch: string | null
  offDefaultBranch: boolean
  missing: boolean
  error: string | null
}

const listGraphs = (a: Instance) => api<Summary[]>(a, 'list_graphs')

/** Setup only: register a new graph file without the dialog. */
const createGraphApi = (
  a: Instance,
  title: string,
  path: string,
  type = 'roadmap'
) => api<Summary>(a, 'create_graph', { title, graphType: type, path })

/** Setup only: add a node without the outline. */
const addNodeApi = (a: Instance, graphId: string, title: string) =>
  api<{ id: string }>(a, 'create_graph_node', { graphId, node: { title } })

const fileId = (path: string) =>
  /^id: (\S+)$/m.exec(readFileSync(path, 'utf8'))?.[1] ?? null

/** The poller compares mtimes: write in a later second than the last write. */
async function writeOutside(path: string, text: string): Promise<void> {
  await new Promise(done => setTimeout(done, 1100))
  writeFileSync(path, text)
}

async function expectFile(path: string, check: (text: string) => boolean) {
  await expect
    .poll(() => (existsSync(path) ? check(readFileSync(path, 'utf8')) : false))
    .toBe(true)
}

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

const header = (page: Page) => page.getByTestId('graph-view').locator('header')

/** The header chip with the file path (its tooltip is the absolute path). */
const fileChip = (page: Page, path: string) =>
  header(page).locator(`[title="${path}"]`)

function nodeRow(page: Page, title: string) {
  return page
    .getByTestId('graph-outline')
    .locator('[data-testid^="graph-node-row-"]')
    .filter({ hasText: title })
}

async function openGraph(page: Page, id: string, title: string) {
  await showSidebarTab(page, 'graphs')
  await graphRow(page, id).click()
  await expect(page.getByTestId('graph-title')).toHaveText(title)
}

async function openNewDialog(page: Page): Promise<Locator> {
  await page
    .getByTestId('sidebar-graphs-section')
    .getByRole('button', { name: 'New graph' })
    .click()
  const dialog = page.getByTestId('new-graph-dialog')
  await expect(dialog).toBeVisible()
  return dialog
}

/** Web access: the server's folder browser. */
async function chooseFolder(page: Page, dialog: Locator, folder: string) {
  await dialog.getByRole('button', { name: 'Choose folder…' }).click()
  const browser = page
    .getByRole('dialog')
    .filter({ hasText: 'Choose a folder for the graph' })
  await browser.getByLabel('Current path').fill(folder)
  await browser.getByLabel('Current path').press('Enter')
  await expect(browser.getByLabel('Current path')).toHaveValue(
    new RegExp(`${folder.split('/').pop()}$`)
  )
  await browser.getByRole('button', { name: 'Select current folder' }).click()
  await expect(browser).toBeHidden()
}

/** Web access: "Open existing graph file…" falls back to a path field. */
async function openExisting(page: Page, path: string): Promise<Locator> {
  const dialog = await openNewDialog(page)
  await dialog
    .getByRole('button', { name: 'Open existing graph file…' })
    .click()
  await dialog.getByLabel('Graph file path').fill(path)
  await dialog.getByRole('button', { name: 'Open', exact: true }).click()
  return dialog
}

/** The newest toast with this text (older ones may still be on screen). */
function toast(page: Page, text: string | RegExp) {
  return page.locator('[data-sonner-toast]').filter({ hasText: text }).last()
}

async function addNode(page: Page, title: string) {
  const add = page.getByTestId('graph-add-node')
  if (!(await add.isVisible())) {
    await page.getByRole('button', { name: 'Add node' }).click()
  }
  await add.getByLabel('New node title').fill(title)
  await add.getByLabel('New node title').press('Enter')
  await expect(nodeRow(page, title)).toBeVisible()
}

/**
 * Untracked graph files this spec leaves in the shared fixture repo `alpha`.
 * Other specs expect a clean `git status` there, so each test unregisters
 * them (cleanup, no UI needed) and deletes the files.
 */
const alphaLeftovers: { id: string; path: string }[] = []

test.afterEach(async () => {
  const { a } = readEnv()
  for (const { id, path } of alphaLeftovers.splice(0)) {
    await api(a, 'remove_graph', { graphId: id })
    rmSync(path, { force: true })
  }
})

// ---------------------------------------------------------------------------
// 1. Three locations
// ---------------------------------------------------------------------------

test('New graph in a project repo, another repo and a plain folder', async ({
  page,
}) => {
  const { a } = readEnv()
  const tag = uid()
  const alpha = join(a.repos, 'alpha')
  const otherName = `other-${tag}`
  const other = createRepo(a, otherName)
  git(other, 'checkout', '-q', '-b', 'trunk')
  const folder = join(a.root, `gf-folder-${tag}`)
  mkdirSync(folder, { recursive: true })

  await openWithSidebar(page)

  // 1a. Inside a project's repo.
  const repoTitle = `Repo graph ${tag}`
  const repoRel = `.splitkick/graphs/repo-graph-${tag}.yml`
  let dialog = await openNewDialog(page)
  await dialog.getByLabel('Title').fill(repoTitle)
  await dialog.getByRole('button', { name: 'release', exact: true }).click()
  await dialog.getByRole('radio', { name: "Inside a project's repo" }).click()
  await dialog
    .getByLabel('Project', { exact: true })
    .selectOption({ label: 'alpha' })
  await expect(dialog.getByLabel('Path in repo')).toHaveValue(repoRel)
  await expect(dialog.getByTestId('graph-location-info')).toHaveText(
    'git repo · on main · the file is new: "Commit graph" adds it.'
  )
  await dialog.getByRole('button', { name: 'Create graph' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('graph-title')).toHaveText(repoTitle)

  // 1b. In another repo (a git repo that is not a Splitkick project).
  const otherTitle = `Other graph ${tag}`
  const otherRel = `.splitkick/graphs/other-graph-${tag}.yml`
  dialog = await openNewDialog(page)
  await dialog.getByLabel('Title').fill(otherTitle)
  await dialog.getByRole('radio', { name: 'In another repo' }).click()
  await chooseFolder(page, dialog, other)
  await expect(dialog.getByLabel('Path in repo')).toHaveValue(otherRel)
  await expect(dialog.getByTestId('graph-location-info')).toHaveText(
    'git repo · on trunk · the file is new: "Commit graph" adds it.'
  )
  await dialog.getByRole('button', { name: 'Create graph' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('graph-title')).toHaveText(otherTitle)

  // 1c. In a folder outside any repo.
  const folderTitle = `Folder graph ${tag}`
  dialog = await openNewDialog(page)
  await dialog.getByLabel('Title').fill(folderTitle)
  await dialog.getByRole('button', { name: 'research', exact: true }).click()
  await dialog
    .getByRole('radio', { name: 'In a folder outside any repo' })
    .click()
  await chooseFolder(page, dialog, folder)
  await expect(dialog.getByLabel('File name')).toHaveValue(
    `folder-graph-${tag}.yml`
  )
  await expect(dialog.getByTestId('graph-location-info')).toHaveText(
    'no git: not versioned'
  )
  await dialog.getByRole('button', { name: 'Create graph' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('graph-title')).toHaveText(folderTitle)

  // The registry: location kinds and paths.
  const all = await listGraphs(a)
  const repoG = all.find(g => g.title === repoTitle)!
  const otherG = all.find(g => g.title === otherTitle)!
  const folderG = all.find(g => g.title === folderTitle)!
  alphaLeftovers.push({ id: repoG.id, path: repoG.path })
  expect(repoG.locationKind).toBe('project-repo')
  expect(otherG.locationKind).toBe('other-repo')
  expect(folderG.locationKind).toBe('folder')
  expect(repoG.path).toBe(join(alpha, repoRel))
  // The server's folder browser hands back resolved paths (/tmp → /private/tmp).
  expect(otherG.path).toBe(join(realpathSync(other), otherRel))
  expect(folderG.path).toBe(
    join(realpathSync(folder), `folder-graph-${tag}.yml`)
  )

  // The YAML on disk.
  for (const [g, type] of [
    [repoG, 'release'],
    [otherG, 'roadmap'],
    [folderG, 'research'],
  ] as const) {
    const text = readFileSync(g.path, 'utf8')
    expect(text).toMatch(
      /^id: [0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/m
    )
    expect(fileId(g.path)).toBe(g.id)
    expect(text).toContain(`title: ${g.title}\n`)
    expect(text).toContain(`type: ${type}\n`)
    expect(text).toMatch(/^nodes: \[\]$/m)
  }

  // Sidebar rows: "type · where".
  await expect(graphRow(page, repoG.id)).toContainText('release · alpha repo')
  await expect(graphRow(page, otherG.id)).toContainText(
    `roadmap · ${otherName} repo`
  )
  await expect(graphRow(page, folderG.id)).toContainText(
    `research · ${realpathSync(folder)}`
  )

  // Header chips: where, the file (relative in a repo), the branch.
  await openGraph(page, repoG.id, repoTitle)
  await expect(header(page)).toContainText('alpha repo')
  await expect(fileChip(page, repoG.path)).toHaveText(repoRel)
  await expect(page.getByTestId('graph-branch-chip')).toHaveText('main')
  await openGraph(page, otherG.id, otherTitle)
  await expect(header(page)).toContainText(`${otherName} repo`)
  await expect(fileChip(page, otherG.path)).toHaveText(otherRel)
  await expect(page.getByTestId('graph-branch-chip')).toHaveText('trunk')
  await openGraph(page, folderG.id, folderTitle)
  await expect(header(page)).toContainText(`${realpathSync(folder)} `)
  await expect(fileChip(page, folderG.path)).toHaveText(folderG.path)
  await expect(page.getByTestId('graph-branch-chip')).toHaveCount(0)
})

// ---------------------------------------------------------------------------
// 2. Dialog validation
// ---------------------------------------------------------------------------

test('New graph dialog validates title, existing file, extension and folders', async ({
  page,
}) => {
  const { a } = readEnv()
  const tag = uid()
  const folder = join(a.root, `gf-valid-${tag}`)
  mkdirSync(folder, { recursive: true })
  const taken = join(folder, 'taken.yml')
  writeFileSync(taken, 'title: Taken\nnodes: []\n')

  await openWithSidebar(page)
  const dialog = await openNewDialog(page)
  const create = dialog.getByRole('button', { name: 'Create graph' })
  await dialog
    .getByRole('radio', { name: 'In a folder outside any repo' })
    .click()
  await chooseFolder(page, dialog, folder)

  // Empty title: disabled.
  await expect(dialog.getByLabel('Title')).toHaveValue('')
  await expect(create).toBeDisabled()
  await dialog.getByLabel('Title').fill('   ')
  await expect(create).toBeDisabled()

  // The file already exists: disabled, with a message.
  await dialog.getByLabel('Title').fill(`Valid ${tag}`)
  await dialog.getByLabel('File name').fill('taken.yml')
  await expect(
    dialog.getByText('A file already exists there.', { exact: false })
  ).toBeVisible()
  await expect(create).toBeDisabled()

  // Not .yml: the backend refuses, nothing is written, the dialog stays.
  await dialog.getByLabel('File name').fill(`notes-${tag}.txt`)
  await expect(
    dialog.getByText('A file already exists there.', { exact: false })
  ).toBeHidden()
  await expect(create).toBeEnabled()
  await create.click()
  await expect(toast(page, 'The graph file must end in .yml')).toBeVisible()
  await expect(dialog).toBeVisible()
  expect(existsSync(join(folder, `notes-${tag}.txt`))).toBe(false)

  // Missing nested folders are created; `.yaml` is accepted.
  const nested = `deep-${tag}/er/plan.yaml`
  await dialog.getByLabel('File name').fill(nested)
  await expect(dialog.getByTestId('graph-location-info')).toHaveText(
    'no git: not versioned'
  )
  await create.click()
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('graph-title')).toHaveText(`Valid ${tag}`)
  const path = join(realpathSync(folder), nested)
  expect(existsSync(path)).toBe(true)
  const g = (await listGraphs(a)).find(s => s.path === path)
  expect(g?.locationKind).toBe('folder')
  expect(fileId(path)).toBe(g?.id)
  // The pre-existing file was never registered.
  expect(
    (await listGraphs(a)).some(s =>
      s.path.endsWith(`gf-valid-${tag}/taken.yml`)
    )
  ).toBe(false)
})

// ---------------------------------------------------------------------------
// 3. Open existing graph file
// ---------------------------------------------------------------------------

test('Open existing graph file: with id, without id, invalid, duplicate id, moved file', async ({
  page,
}) => {
  const { a } = readEnv()
  const tag = uid()
  const folder = join(a.root, `gf-open-${tag}`)
  mkdirSync(folder, { recursive: true })
  await openWithSidebar(page)

  // A valid file with an id: registered under that id, file untouched.
  const withId = join(folder, 'with-id.yml')
  const id1 = randomUUID()
  const withIdText = `id: ${id1}\ntitle: With id ${tag}\ntype: research\nnodes:\n- id: aaa111\n  title: First\n`
  writeFileSync(withId, withIdText)
  let dialog = await openExisting(page, withId)
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('graph-title')).toHaveText(`With id ${tag}`)
  await expect(nodeRow(page, 'First')).toBeVisible()
  await expect(graphRow(page, id1)).toBeVisible()
  expect(readFileSync(withId, 'utf8')).toBe(withIdText)

  // A file without an id: an id is written into the file.
  const noId = join(folder, 'no-id.yml')
  writeFileSync(noId, `title: No id ${tag}\nnodes: []\n`)
  dialog = await openExisting(page, noId)
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('graph-title')).toHaveText(`No id ${tag}`)
  const writtenId = fileId(noId)
  expect(writtenId).toMatch(/^[0-9a-f-]{36}$/)
  expect(readFileSync(noId, 'utf8')).toContain(`title: No id ${tag}`)
  await expect(graphRow(page, writtenId!)).toBeVisible()
  // No type in the file: the row's second line has no stray "·".
  await expect(graphRow(page, writtenId!)).not.toContainText('·')

  // Invalid YAML: error shown, nothing registered, file untouched.
  const invalid = join(folder, 'invalid.yml')
  const invalidText = `title: Broken ${tag}\nnodes: [\n  - id: x\n`
  writeFileSync(invalid, invalidText)
  dialog = await openExisting(page, invalid)
  await expect(toast(page, 'Could not open the graph file')).toBeVisible()
  await expect(toast(page, 'Invalid graph file')).toBeVisible()
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  expect((await listGraphs(a)).some(g => g.path === invalid)).toBe(false)
  expect(readFileSync(invalid, 'utf8')).toBe(invalidText)

  // Same id already registered at a path that exists: refused.
  const copy = join(folder, 'copy.yml')
  copyFileSync(withId, copy)
  dialog = await openExisting(page, copy)
  await expect(
    toast(page, `A graph with id ${id1} is already registered at ${withId}`)
  ).toBeVisible()
  await page.keyboard.press('Escape')
  const afterCopy = (await listGraphs(a)).filter(g => g.id === id1)
  expect(afterCopy.map(g => g.path)).toEqual([withId])

  // Same id registered at a path that no longer exists: re-pointed.
  const moved = join(folder, 'moved.yml')
  renameSync(withId, moved)
  await expect(
    graphRow(page, id1).getByTestId('sidebar-graph-warning')
  ).toHaveAttribute('aria-label', 'File missing', { timeout: 10_000 })
  dialog = await openExisting(page, moved)
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('graph-title')).toHaveText(`With id ${tag}`)
  const afterMove = (await listGraphs(a)).filter(g => g.id === id1)
  expect(afterMove.map(g => g.path)).toEqual([moved])
  await expect(
    graphRow(page, id1).getByTestId('sidebar-graph-warning')
  ).toHaveCount(0)
  await expect(graphRow(page, id1)).toHaveCount(1)
})

// ---------------------------------------------------------------------------
// 4. Remove from list
// ---------------------------------------------------------------------------

test('Remove from list keeps the file; opening it again works', async ({
  page,
}) => {
  const { a } = readEnv()
  const tag = uid()
  const folder = join(a.root, `gf-remove-${tag}`)
  const path = join(folder, 'remove-me.yml')
  const title = `Remove me ${tag}`
  const g = await createGraphApi(a, title, path) // setup
  await openWithSidebar(page)
  await openGraph(page, g.id, title)

  await header(page).getByRole('button', { name: 'Remove from list' }).click()
  await expect(toast(page, 'Graph removed from the list')).toBeVisible()
  await expect(graphRow(page, g.id)).toHaveCount(0)
  await expect(page.getByTestId('graph-view')).toHaveCount(0)
  expect(existsSync(path)).toBe(true)
  expect((await listGraphs(a)).some(s => s.id === g.id)).toBe(false)

  const dialog = await openExisting(page, path)
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('graph-title')).toHaveText(title)
  await expect(graphRow(page, g.id)).toBeVisible()
  expect(fileId(path)).toBe(g.id)
})

// ---------------------------------------------------------------------------
// 5. Missing file
// ---------------------------------------------------------------------------

test('a deleted graph file shows as missing; restoring it recovers without reload', async ({
  page,
}) => {
  const { a } = readEnv()
  const tag = uid()
  const path = join(a.root, `gf-missing-${tag}`, 'missing.yml')
  const title = `Missing ${tag}`
  const g = await createGraphApi(a, title, path) // setup
  await addNodeApi(a, g.id, 'Still here') // setup
  const original = readFileSync(path, 'utf8')

  await openWithSidebar(page)
  await openGraph(page, g.id, title)
  await expect(nodeRow(page, 'Still here')).toBeVisible()

  rmSync(path)
  const warning = graphRow(page, g.id).getByTestId('sidebar-graph-warning')
  await expect(warning).toHaveAttribute('aria-label', 'File missing', {
    timeout: 10_000,
  })
  await expect(page.getByTestId('graph-load-error')).toContainText(
    `Graph file not found: ${path}`
  )
  await expect(page.getByTestId('graph-outline')).toHaveCount(0)
  await shot(page, 'missing-file')
  // Still registered: the user decides.
  expect((await listGraphs(a)).find(s => s.id === g.id)?.missing).toBe(true)

  await writeOutside(path, original)
  await expect(warning).toHaveCount(0, { timeout: 10_000 })
  await expect(nodeRow(page, 'Still here')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('graph-title')).toHaveText(title)
})

// ---------------------------------------------------------------------------
// 6. Outside edits
// ---------------------------------------------------------------------------

test('outside edits show without reload; a broken file is never overwritten', async ({
  page,
}) => {
  const { a } = readEnv()
  const tag = uid()
  const path = join(a.root, `gf-outside-${tag}`, 'outside.yml')
  const title = `Outside ${tag}`
  const g = await createGraphApi(a, title, path) // setup
  await addNodeApi(a, g.id, 'Keep') // setup
  await addNodeApi(a, g.id, 'Goes away') // setup

  await openWithSidebar(page)
  await openGraph(page, g.id, title)
  await expect(nodeRow(page, 'Goes away')).toBeVisible()

  // Title change.
  let text = readFileSync(path, 'utf8')
  await writeOutside(
    path,
    text.replace(`title: ${title}\n`, `title: ${title} v2\n`)
  )
  await expect(page.getByTestId('graph-title')).toHaveText(`${title} v2`, {
    timeout: 5_000,
  })
  await expect(graphRow(page, g.id)).toContainText(`${title} v2`)

  // Node added.
  text = readFileSync(path, 'utf8')
  await writeOutside(path, `${text}- id: out001\n  title: Added outside\n`)
  await expect(nodeRow(page, 'Added outside')).toBeVisible({ timeout: 5_000 })

  // Node removed.
  text = readFileSync(path, 'utf8')
  const without = text.replace(
    /- id: \w+\n {2}title: Goes away\n {2}state: proposed\n/,
    ''
  )
  expect(without).not.toBe(text)
  await writeOutside(path, without)
  await expect(nodeRow(page, 'Goes away')).toHaveCount(0, { timeout: 5_000 })
  await expect(nodeRow(page, 'Keep')).toBeVisible()

  // Invalid YAML: error state, the file is left alone.
  const good = readFileSync(path, 'utf8')
  const broken = `${good}  - : : [ broken\n`
  await writeOutside(path, broken)
  await expect(page.getByTestId('graph-load-error')).toContainText(
    'Invalid graph file',
    { timeout: 10_000 }
  )
  await expect(
    graphRow(page, g.id).getByTestId('sidebar-graph-warning')
  ).toHaveAttribute('aria-label', /Invalid graph file/)
  await shot(page, 'invalid-file')
  // The view offers no edit now; a write through the API (no UI) is refused
  // and does not touch the file.
  await expect(
    api(a, 'update_graph', { graphId: g.id, title: 'Clobbered' })
  ).rejects.toThrow(/Invalid graph file/)
  await new Promise(done => setTimeout(done, 4500)) // two poller rounds
  expect(readFileSync(path, 'utf8')).toBe(broken)

  // Fixing the file recovers.
  await writeOutside(path, good)
  await expect(nodeRow(page, 'Keep')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('graph-load-error')).toHaveCount(0)

  // A UI edit right after an outside edit keeps both.
  await nodeRow(page, 'Keep').click()
  const detail = page.getByTestId('graph-node-detail')
  await expect(detail.getByLabel('Node title')).toHaveValue('Keep')
  await new Promise(done => setTimeout(done, 1100))
  writeFileSync(
    path,
    readFileSync(path, 'utf8').replace(
      'title: Added outside\n',
      'title: Added outside (edited)\n'
    )
  )
  await detail.getByLabel('Node title').fill('Keep (UI)')
  await detail.getByLabel('Node title').press('Enter')
  await expectFile(
    path,
    t =>
      t.includes('title: Keep (UI)\n') &&
      t.includes('title: Added outside (edited)\n')
  )
  await expect(nodeRow(page, 'Added outside (edited)')).toBeVisible({
    timeout: 10_000,
  })
  await expect(nodeRow(page, 'Keep (UI)')).toBeVisible()
})

// ---------------------------------------------------------------------------
// 7. Preservation
// ---------------------------------------------------------------------------

/** The lines of one node block (from `- id: <id>` to the next node). */
function nodeBlock(text: string, id: string): string {
  const start = text.indexOf(`- id: ${id}\n`)
  if (start < 0) throw new Error(`no node ${id}`)
  const next = text.indexOf('\n- id: ', start + 1)
  return text.slice(start, next < 0 ? undefined : next + 1)
}

test('unknown fields, relation kinds and attachment kinds survive a UI edit', async ({
  page,
}) => {
  const { a } = readEnv()
  const tag = uid()
  const folder = join(a.root, `gf-keep-${tag}`)
  mkdirSync(folder, { recursive: true })
  const path = join(folder, 'hand-written.yml')
  const title = `Hand written ${tag}`
  writeFileSync(
    path,
    [
      `title: ${title}`,
      'type: roadmap',
      'owner: someone@example.invalid',
      'review-cadence:',
      '  every: 2w',
      'nodes:',
      '  - id: keep01',
      '    title: Untouched',
      '    estimate: 3d',
      '    relations:',
      '      - supersedes: old999',
      '      - relates-to: edit01',
      '    attachments:',
      '      - figma: https://example.invalid/file/abc',
      '      - note: keep me',
      '  - id: edit01',
      '    title: To edit',
      '    owner-note: hands off',
      '    relations:',
      '      - supersedes: keep01',
      '    attachments:',
      '      - figma: https://example.invalid/file/def',
      '  - id: keep02',
      '    title: Also untouched',
      '    state: committed',
      '',
    ].join('\n')
  )

  await openWithSidebar(page)
  const dialog = await openExisting(page, path)
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('graph-title')).toHaveText(title)
  const id = fileId(path)!

  // First UI edit (normalising save): a description on "To edit".
  await nodeRow(page, 'To edit').click()
  const detail = page.getByTestId('graph-node-detail')
  await detail.getByLabel('Description').fill('First edit')
  await detail.getByLabel('Description').blur()
  await expectFile(path, t => t.includes('description: First edit'))

  const first = readFileSync(path, 'utf8')
  expect(first).toContain(`id: ${id}`)
  expect(first).toContain('owner: someone@example.invalid')
  expect(first).toMatch(/review-cadence:\n {2}every: 2w/)
  expect(first).toContain('estimate: 3d')
  expect(first).toContain('owner-note: hands off')
  expect(first).toContain('supersedes: old999')
  expect(first).toContain('supersedes: keep01')
  expect(first).toContain('figma: https://example.invalid/file/abc')
  expect(first).toContain('figma: https://example.invalid/file/def')
  expect(first).toContain('note: keep me')
  expect(first).toContain('relates-to: edit01')
  // The known relation on the other node still resolves in the UI.
  await expect(detail).toContainText('Untouched')

  // Second UI edit: only that node's lines change.
  await detail.getByLabel('Description').fill('Second edit')
  await detail.getByLabel('Description').blur()
  await expectFile(path, t => t.includes('description: Second edit'))
  const second = readFileSync(path, 'utf8')
  expect(nodeBlock(second, 'keep01')).toBe(nodeBlock(first, 'keep01'))
  expect(nodeBlock(second, 'keep02')).toBe(nodeBlock(first, 'keep02'))
  expect(second.slice(0, second.indexOf('nodes:'))).toBe(
    first.slice(0, first.indexOf('nodes:'))
  )
  expect(nodeBlock(second, 'edit01')).toContain('supersedes: keep01')
  expect(nodeBlock(second, 'edit01')).toContain('owner-note: hands off')
})

// ---------------------------------------------------------------------------
// 8. Branches
// ---------------------------------------------------------------------------

test('off-default-branch warning follows the project checkout', async ({
  page,
}) => {
  const { a } = readEnv()
  const tag = uid()
  const alpha = join(a.repos, 'alpha')
  const path = join(alpha, `.splitkick/graphs/branch-${tag}.yml`)
  const title = `Branch ${tag}`
  const g = await createGraphApi(a, title, path) // setup
  alphaLeftovers.push({ id: g.id, path })
  expect(git(alpha, 'branch', '--show-current')).toBe('main')

  await openWithSidebar(page)
  await openGraph(page, g.id, title)
  const chip = page.getByTestId('graph-branch-chip')
  await expect(chip).toHaveText('main')
  await expect(chip).not.toHaveAttribute('title', /.+/)
  await expect(
    graphRow(page, g.id).getByTestId('sidebar-graph-warning')
  ).toHaveCount(0)

  const branch = `e2e-off-${tag}`
  git(alpha, 'checkout', '-q', '-b', branch)
  try {
    // A branch switch does not touch the file's mtime, so the poller does
    // not notice it; the next load shows it (design, see the report).
    await page.reload()
    await openWithSidebar(page)
    await openGraph(page, g.id, title)
    await expect(chip).toHaveText(branch)
    await expect(chip).toHaveAttribute('title', 'The checkout is not on main')
    await expect(
      graphRow(page, g.id).getByTestId('sidebar-graph-warning')
    ).toHaveAttribute('aria-label', `Checkout is on ${branch}, not main`)
    const s = (await listGraphs(a)).find(x => x.id === g.id)!
    expect(s.offDefaultBranch).toBe(true)
    expect(s.branch).toBe(branch)
    await shot(page, 'off-default-branch')
  } finally {
    git(alpha, 'checkout', '-q', 'main')
  }

  await page.reload()
  await openWithSidebar(page)
  await openGraph(page, g.id, title)
  await expect(chip).toHaveText('main')
  await expect(
    graphRow(page, g.id).getByTestId('sidebar-graph-warning')
  ).toHaveCount(0)
  expect((await listGraphs(a)).find(x => x.id === g.id)?.offDefaultBranch).toBe(
    false
  )
})

// ---------------------------------------------------------------------------
// 9. Commit graph
// ---------------------------------------------------------------------------

test('Commit graph: only the file, untracked file, nothing to commit, other repo, folder', async ({
  page,
}) => {
  const { a } = readEnv()
  const tag = uid()
  const alpha = join(a.repos, 'alpha')
  const rel = `.splitkick/graphs/commit-${tag}.yml`
  const path = join(alpha, rel)
  const title = `Commit ${tag}`
  const g = await createGraphApi(a, title, path) // setup: new, untracked
  expect(git(alpha, 'status', '--porcelain', '--', rel)).toBe(`?? ${rel}`)

  // Another modified file and another staged file in the same repo.
  const readme = join(alpha, 'README.md')
  const readmeBefore = readFileSync(readme, 'utf8')
  const stagedRel = `staged-${tag}.txt`
  writeFileSync(readme, `${readmeBefore}\nUnrelated ${tag}\n`)
  writeFileSync(join(alpha, stagedRel), 'staged\n')
  git(alpha, 'add', stagedRel)
  const head = git(alpha, 'rev-parse', 'HEAD')

  try {
    await openWithSidebar(page)
    await openGraph(page, g.id, title)
    const commit = header(page).getByRole('button', { name: 'Commit graph' })

    // A brand-new untracked graph file is committed, alone.
    await commit.click()
    await expect(toast(page, `Committed ${title}`)).toBeVisible()
    const sha1 = git(alpha, 'rev-parse', 'HEAD')
    await expect(toast(page, `Committed ${title}`)).toContainText(
      sha1.slice(0, 7)
    )
    expect(git(alpha, 'rev-parse', 'HEAD^')).toBe(head)
    expect(git(alpha, 'show', '--name-only', '--format=%s', 'HEAD')).toBe(
      `graph: update ${title}\n\n${rel}`
    )
    expect(git(alpha, 'diff', '--cached', '--name-only')).toBe(stagedRel)
    expect(git(alpha, 'diff', '--name-only')).toBe('README.md')
    expect(git(alpha, 'status', '--porcelain', '--', rel)).toBe('')

    // A modified graph file is committed, alone; the staged file stays staged.
    await addNode(page, 'Committed node')
    await expectFile(path, t => t.includes('title: Committed node'))
    await commit.click()
    await expect.poll(() => git(alpha, 'rev-parse', 'HEAD')).not.toBe(sha1)
    const sha2 = git(alpha, 'rev-parse', 'HEAD')
    await expect(toast(page, sha2.slice(0, 7))).toContainText(
      `Committed ${title}`
    )
    expect(git(alpha, 'show', '--name-only', '--format=', 'HEAD')).toBe(rel)
    expect(git(alpha, 'diff', '--cached', '--name-only')).toBe(stagedRel)

    // Nothing to commit: a clear message, no new commit, the view stays.
    await commit.click()
    await expect(
      toast(page, `Nothing to commit: ${rel} has no changes`)
    ).toBeVisible()
    expect(git(alpha, 'rev-parse', 'HEAD')).toBe(sha2)
    await expect(page.getByTestId('graph-title')).toHaveText(title)
  } finally {
    git(alpha, 'rm', '-q', '--cached', stagedRel)
    rmSync(join(alpha, stagedRel))
    writeFileSync(readme, readmeBefore)
  }

  // Another repo.
  const otherName = `commit-other-${tag}`
  const other = createRepo(a, otherName)
  const otherRel = 'graphs/plan.yml'
  const otherTitle = `Commit other ${tag}`
  const og = await createGraphApi(a, otherTitle, join(other, otherRel)) // setup
  await openGraph(page, og.id, otherTitle)
  await header(page).getByRole('button', { name: 'Commit graph' }).click()
  await expect(toast(page, `Committed ${otherTitle}`)).toBeVisible()
  expect(git(other, 'show', '--name-only', '--format=', 'HEAD')).toBe(otherRel)
  expect(git(other, 'status', '--porcelain')).toBe('')

  // A folder graph has no Commit button.
  const folderTitle = `Commit folder ${tag}`
  const fg = await createGraphApi(
    a,
    folderTitle,
    join(a.root, `gf-commit-${tag}`, 'g.yml')
  ) // setup
  await openGraph(page, fg.id, folderTitle)
  await expect(
    header(page).getByRole('button', { name: 'Commit graph' })
  ).toHaveCount(0)
})

// ---------------------------------------------------------------------------
// 10. Header edits
// ---------------------------------------------------------------------------

test('header: rename the title and change the type inline', async ({
  page,
}) => {
  const { a } = readEnv()
  const tag = uid()
  const path = join(a.root, `gf-header-${tag}`, 'header.yml')
  const title = `Header ${tag}`
  const g = await createGraphApi(a, title, path) // setup
  await openWithSidebar(page)
  await openGraph(page, g.id, title)

  await page.getByTestId('graph-title').click()
  await page.getByLabel('Graph title').fill(`${title} renamed`)
  await page.getByLabel('Graph title').press('Enter')
  await expect(page.getByTestId('graph-title')).toHaveText(`${title} renamed`)
  await expectFile(path, t => t.includes(`title: ${title} renamed\n`))
  await expect(graphRow(page, g.id)).toContainText(`${title} renamed`)

  await page.getByTestId('graph-type').click()
  await page.getByLabel('Graph type').fill('release')
  await page.getByLabel('Graph type').press('Enter')
  await expect(page.getByTestId('graph-type')).toHaveText('release')
  await expectFile(path, t => t.includes('type: release\n'))
  await expect(graphRow(page, g.id)).toContainText('release · ')

  // Escape cancels.
  await page.getByTestId('graph-type').click()
  await page.getByLabel('Graph type').fill('nope')
  await page.getByLabel('Graph type').press('Escape')
  await expect(page.getByTestId('graph-type')).toHaveText('release')
  expect(readFileSync(path, 'utf8')).toContain('type: release\n')
})

// ---------------------------------------------------------------------------
// 11. Sidebar
// ---------------------------------------------------------------------------

test('sidebar: collapse persists, counts, selected row', async ({ page }) => {
  const { a, alphaA } = readEnv()
  const tag = uid()
  const path = join(a.root, `gf-sidebar-${tag}`, 'sidebar.yml')
  const title = `Sidebar ${tag}`
  const g = await createGraphApi(a, title, path) // setup
  const node = await addNodeApi(a, g.id, 'Asked about') // setup

  // Counts need an agent's writes: no UI makes them, so the MCP socket does.
  const sessionId = await createSession(a, alphaA, `Counts ${tag}`)
  await api(a, 'set_session_graph_permission', {
    sessionId,
    permission: 'write',
  })
  await mcp(a, sessionId, 'create_node', {
    graphId: g.id,
    title: 'Agent node',
    why: 'E2E: unseen count',
  })
  await mcp(a, sessionId, 'send_request', {
    graphId: g.id,
    nodeId: node.id,
    kind: 'accept-done',
    title: 'Done?',
  })

  await openWithSidebar(page)
  const row = graphRow(page, g.id)
  await expect(row.getByTestId('sidebar-graph-requests')).toHaveText('1')
  await expect(row.getByTestId('sidebar-graph-requests')).toHaveClass(
    /bg-orange-500/
  )
  await expect(row.getByTestId('sidebar-graph-unseen')).toHaveText('1')
  await expect(row.getByTestId('sidebar-graph-unseen')).toHaveClass(/bg-muted/)

  // Selected row.
  await expect(row).not.toHaveAttribute('aria-current', 'page')
  await openGraph(page, g.id, title)
  await expect(row).toHaveAttribute('aria-current', 'page')
  await expect(
    page.locator('[data-testid^="sidebar-graph-row-"][aria-current="page"]')
  ).toHaveCount(1)

  // The Graphs tab counts the requests that wait for the user.
  const graphsTab = page.getByTestId('sidebar-tab-graphs')
  await expect(page.getByTestId('sidebar-tab-count-graphs')).toHaveText('1')

  // The selected tab persists across a reload, and so does Projects.
  await new Promise(done => setTimeout(done, 1000)) // debounced UI-state save
  await page.reload()
  await expect(page.getByText('Go to…').first()).toBeVisible()
  await expect(graphsTab).toHaveAttribute('aria-selected', 'true')
  await expect(row).toBeVisible()
  await showSidebarTab(page, 'projects')
  await expect(row).toHaveCount(0)
  await new Promise(done => setTimeout(done, 1000))
  await page.reload()
  await expect(page.getByText('Go to…').first()).toBeVisible()
  await expect(page.getByTestId('sidebar-tab-projects')).toHaveAttribute(
    'aria-selected',
    'true'
  )
})

// ---------------------------------------------------------------------------
// 12. Navigation
// ---------------------------------------------------------------------------

test('navigation: Home, back/forward, project, worktree, Archived, reload', async ({
  page,
}) => {
  const { a, alphaA } = readEnv()
  const tag = uid()
  const path = join(a.root, `gf-nav-${tag}`, 'nav.yml')
  const title = `Nav ${tag}`
  const g = await createGraphApi(a, title, path) // setup
  await openWithSidebar(page)
  const view = page.getByTestId('graph-view')
  const row = graphRow(page, g.id)
  const settle = () => new Promise(done => setTimeout(done, 500)) // history settles at 300 ms

  // Home clears it.
  await openGraph(page, g.id, title)
  await settle()
  await page.getByTestId('sidebar-home-row').click()
  await expect(view).toHaveCount(0)
  await expect(row).not.toHaveAttribute('aria-current', 'page')
  await settle()

  // Back returns to the graph, forward to Home.
  await page.getByRole('button', { name: 'Go back' }).click()
  await expect(page.getByTestId('graph-title')).toHaveText(title)
  await expect(row).toHaveAttribute('aria-current', 'page')
  await settle()
  await page.getByRole('button', { name: 'Go forward' }).click()
  await expect(view).toHaveCount(0)

  // Selecting a project clears it. Projects and graphs are separate tabs.
  await openGraph(page, g.id, title)
  await showSidebarTab(page, 'projects')
  await page.getByTestId(`project-row-${alphaA.projectId}`).click()
  await expect(view).toHaveCount(0)
  await showSidebarTab(page, 'graphs')
  await expect(row).not.toHaveAttribute('aria-current', 'page')

  // Selecting a worktree clears it.
  await openGraph(page, g.id, title)
  await showSidebarTab(page, 'projects')
  const expand = page
    .getByTestId(`project-row-${alphaA.projectId}`)
    .getByRole('button', { name: 'Expand project' })
  if (await expand.isVisible()) await expand.click()
  const worktree = page
    .getByTestId('sidebar-projects-scroll')
    .getByText('feature-a', { exact: true })
    .first()
  await expect(worktree).toBeVisible()
  await worktree.click()
  await expect(view).toHaveCount(0)

  // Archived clears it.
  await openGraph(page, g.id, title)
  await showSidebarTab(page, 'projects')
  await page.getByTestId('sidebar-archived-row').click()
  await expect(view).toHaveCount(0)
  await showSidebarTab(page, 'graphs')
  await expect(row).not.toHaveAttribute('aria-current', 'page')

  // Reload while a graph is open: the open graph is not persisted (design:
  // `activeGraphId` is not in the UI state), so the app comes back without it.
  await page.getByTestId('sidebar-home-row').click()
  await openGraph(page, g.id, title)
  await page.reload()
  await expect(page.getByText('Go to…').first()).toBeVisible()
  await new Promise(done => setTimeout(done, 1500))
  await expect(view).toHaveCount(0)
})

// ---------------------------------------------------------------------------
// 13. Phone layout
// ---------------------------------------------------------------------------

test('phone: tapping a graph shows the graph view; Back returns', async ({
  page,
}) => {
  const { a } = readEnv()
  const tag = uid()
  const path = join(a.root, `gf-phone-${tag}`, 'phone.yml')
  const title = `Phone ${tag}`
  const g = await createGraphApi(a, title, path) // setup
  await addNodeApi(a, g.id, 'Phone node') // setup

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${a.url}/?token=${a.token}`)
  const shell = page.getByTestId('mobile-tab-shell')
  await expect(shell).toBeVisible()
  // The phone has no sidebar: Home → Projects lists the graphs.
  await page.getByTestId('mobile-home-segment-projects').click()
  const row = page.getByTestId(`mobile-graph-row-${g.id}`)
  await expect(row).toContainText(title)
  await expect(row).toContainText('roadmap · ')
  await row.click()

  // The header wraps: the title keeps its room next to the buttons.
  const titleBox = await page.getByTestId('graph-title').boundingBox()
  expect(titleBox?.width ?? 0).toBeGreaterThan(80)
  await expect(page.getByTestId('graph-title')).toBeInViewport()
  await expect(nodeRow(page, 'Phone node')).toBeVisible()
  await expect(shell).toHaveCount(0)
  await shot(page, 'phone-graph')

  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page.getByTestId('graph-view')).toHaveCount(0)
  await expect(shell).toBeVisible()
})
