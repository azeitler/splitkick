import { expect, test, type Page } from '@playwright/test'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { api, createSession, git, readEnv, waitForIdle } from '../helpers'
import { REPO_ROOT } from '../launcher'
import { goToSession, openApp, runCommand, send, uniqueName } from './ui'

// Graph layer (#79), end to end on instance A: the real web UI for the
// graph files, outline, detail, review, agents and the session graph panel;
// the stub CLI (`STUB:mcp …`) for the MCP graph tools as an agent session.
// See docs/developer/graph-layer.md for the contract.

test.describe.configure({ mode: 'serial' })

const SHOTS = join(REPO_ROOT, 'scratch/graph-e2e')

/** `<screen>-YYYYMMDD-HHMMSS.png` under scratch/graph-e2e, stamped now. */
async function shot(page: Page, screen: string): Promise<void> {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: join(SHOTS, `${screen}-${stamp}.png`) })
}

interface YamlNode {
  id: string
  title: string
  state: string
  block: string
}

/** Minimal reader for the graph files Splitkick writes (one node per `- id:`). */
function readNodes(path: string): YamlNode[] {
  const text = readFileSync(path, 'utf8')
  const nodesAt = text.indexOf('\nnodes:\n')
  if (nodesAt < 0) return []
  return text
    .slice(nodesAt + '\nnodes:\n'.length)
    .split(/\n(?=\s*- id: )/)
    .filter(block => /- id: /.test(block))
    .map(block => ({
      id: /- id: (\S+)/.exec(block)?.[1] ?? '',
      title: /\n\s+title: (.*)/.exec(block)?.[1]?.trim() ?? '',
      state: /\n\s+state: (\S+)/.exec(block)?.[1] ?? 'proposed',
      block,
    }))
}

function nodeByTitle(path: string, title: string): YamlNode {
  const node = readNodes(path).find(n => n.title === title)
  if (!node) throw new Error(`no node '${title}' in ${path}`)
  return node
}

/** Wait until the YAML on disk satisfies `check`. */
async function expectFile(path: string, check: (text: string) => boolean) {
  await expect
    .poll(() => (existsSync(path) ? check(readFileSync(path, 'utf8')) : false))
    .toBe(true)
}

/** Open the web UI with the left sidebar shown (a fresh profile hides it). */
async function openWithSidebar(page: Page) {
  const { a } = readEnv()
  await openApp(page, a)
  const show = page.getByRole('button', { name: 'Show sidebar' })
  if (await show.isVisible()) await show.click()
  await expect(page.getByTestId('sidebar-graphs-section')).toBeAttached()
}

function graphRow(page: Page, title: string) {
  return page
    .getByTestId('sidebar-graphs-section')
    .locator('[data-testid^="sidebar-graph-row-"]')
    .filter({ hasText: title })
}

function nodeRow(page: Page, title: string) {
  return page
    .getByTestId('graph-outline')
    .locator('[data-testid^="graph-node-row-"]')
    .filter({ hasText: title })
}

async function openGraph(page: Page, title: string) {
  await graphRow(page, title).click()
  await expect(page.getByTestId('graph-title')).toHaveText(title)
}

async function addNode(page: Page, title: string, parent?: string) {
  const add = page.getByTestId('graph-add-node')
  if (!(await add.isVisible())) {
    await page.getByRole('button', { name: 'Add node' }).click()
  }
  if (parent) {
    await add
      .getByLabel('Parent node')
      .selectOption({ label: `Part of: ${parent}` })
  }
  await add.getByLabel('New node title').fill(title)
  await add.getByLabel('New node title').press('Enter')
  await expect(nodeRow(page, title)).toBeVisible()
}

/** Shared between the serial tests. */
const state = {
  folder: '',
  roadmapPath: '',
  roadmapId: '',
  planPath: '',
  repoPath: '',
  agentName: '',
}

test('New graph dialog creates a folder graph and an in-repo graph', async ({
  page,
}) => {
  const { a } = readEnv()
  state.folder = join(a.root, 'graphs')
  mkdirSync(state.folder, { recursive: true })
  state.roadmapPath = join(state.folder, 'e2e-roadmap.yml')
  state.repoPath = join(a.repos, 'alpha')
  state.planPath = join(state.repoPath, '.splitkick/graphs/alpha-plan.yml')

  await openWithSidebar(page)
  const section = page.getByTestId('sidebar-graphs-section')
  await expect(section).toBeVisible()
  await expect(section.getByText('Graphs', { exact: true })).toBeVisible()

  // 1. In a folder outside any repo (web access: the server's folder browser).
  await section.getByRole('button', { name: 'New graph' }).click()
  const dialog = page.getByTestId('new-graph-dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Title').fill('E2E roadmap')
  await dialog.getByRole('button', { name: 'roadmap', exact: true }).click()
  await dialog
    .getByRole('radio', { name: 'In a folder outside any repo' })
    .click()
  await dialog.getByRole('button', { name: 'Choose folder…' }).click()
  const browser = page
    .getByRole('dialog')
    .filter({ hasText: 'Choose a folder for the graph' })
  await browser.getByLabel('Current path').fill(state.folder)
  await browser.getByLabel('Current path').press('Enter')
  await expect(browser.getByLabel('Current path')).toHaveValue(/graphs$/)
  await browser.getByRole('button', { name: 'Select current folder' }).click()
  await expect(dialog.getByLabel('File name')).toHaveValue('e2e-roadmap.yml')
  await expect(dialog.getByTestId('graph-location-info')).toHaveText(
    'no git: not versioned'
  )
  await shot(page, 'new-graph-dialog')
  await dialog.getByRole('button', { name: 'Create graph' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('graph-title')).toHaveText('E2E roadmap')

  // 2. Inside a project's repo (the fixture repo `alpha`).
  await section.getByRole('button', { name: 'New graph' }).click()
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Title').fill('Alpha plan')
  await dialog.getByRole('radio', { name: "Inside a project's repo" }).click()
  await dialog
    .getByLabel('Project', { exact: true })
    .selectOption({ label: 'alpha' })
  await expect(dialog.getByLabel('Path in repo')).toHaveValue(
    '.splitkick/graphs/alpha-plan.yml'
  )
  await expect(dialog.getByTestId('graph-location-info')).toContainText(
    'git repo · on main'
  )
  await dialog.getByRole('button', { name: 'Create graph' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('graph-title')).toHaveText('Alpha plan')

  // Both in the sidebar, both files on disk.
  await expect(graphRow(page, 'E2E roadmap')).toContainText('roadmap · ')
  await expect(graphRow(page, 'Alpha plan')).toContainText('roadmap · ')

  const roadmap = readFileSync(state.roadmapPath, 'utf8')
  expect(roadmap).toMatch(/^id: [0-9a-f-]{36}$/m)
  expect(roadmap).toContain('title: E2E roadmap')
  expect(roadmap).toContain('type: roadmap')
  state.roadmapId = /^id: (\S+)$/m.exec(roadmap)![1]
  const plan = readFileSync(state.planPath, 'utf8')
  expect(plan).toContain('title: Alpha plan')
  expect(plan).toContain('type: roadmap')

  // The registry knows both, with the right location kinds.
  const graphs = await api<{ title: string; locationKind: string }[]>(
    a,
    'list_graphs'
  )
  expect(graphs.find(g => g.title === 'E2E roadmap')?.locationKind).toBe(
    'folder'
  )
  expect(graphs.find(g => g.title === 'Alpha plan')?.locationKind).toBe(
    'project-repo'
  )
})

test('Outline, node detail and dependencies edit the YAML file', async ({
  page,
}) => {
  const { a } = readEnv()
  await openWithSidebar(page)
  await openGraph(page, 'E2E roadmap')

  await addNode(page, 'Milestone')
  await addNode(page, 'Design', 'Milestone')
  await addNode(page, 'Build', 'Milestone')

  // Children nest under the group node.
  await expect(nodeRow(page, 'Design')).toHaveAttribute('data-depth', '1')
  await expect(nodeRow(page, 'Build')).toHaveAttribute('data-depth', '1')
  await expect(
    nodeRow(page, 'Milestone').getByTestId('node-progress')
  ).toBeVisible()

  // Build depends on Design (node detail → Relations).
  await nodeRow(page, 'Build').click()
  const detail = page.getByTestId('graph-node-detail')
  await expect(detail).toBeVisible()
  await detail.getByLabel('Relation kind').selectOption('depends-on')
  await detail.getByLabel('Relation target').selectOption({ label: 'Design' })
  await detail.getByRole('button', { name: 'Add relation' }).click()
  await expect(
    detail.getByTestId('graph-relation').filter({ hasText: 'depends-on' })
  ).toContainText('Design')

  // Derived: Build is blocked while Design is open.
  await expect(
    nodeRow(page, 'Build').getByTestId('node-blocked-badge')
  ).toBeVisible()
  await expect(detail).toContainText('Derived blocked: depends-on Design')

  // State change on Design in the detail panel.
  await nodeRow(page, 'Design').click()
  await expect(detail.getByLabel('Node title')).toHaveValue('Design')
  await detail.getByRole('radio', { name: 'committed' }).click()
  await expect(
    nodeRow(page, 'Design').getByTestId('node-state-chip')
  ).toHaveText(/committed/)
  await shot(page, 'node-detail')

  // The file on disk has all of it.
  await expectFile(state.roadmapPath, () => {
    const nodes = readNodes(state.roadmapPath)
    const milestone = nodes.find(n => n.title === 'Milestone')
    const design = nodes.find(n => n.title === 'Design')
    const build = nodes.find(n => n.title === 'Build')
    return (
      !!milestone &&
      !!design &&
      !!build &&
      design.state === 'committed' &&
      design.block.includes(`part-of: ${milestone.id}`) &&
      build.block.includes(`part-of: ${milestone.id}`) &&
      build.block.includes(`depends-on: ${design.id}`)
    )
  })
  // Build is still blocked: committed is not closed.
  await expect(
    nodeRow(page, 'Build').getByTestId('node-blocked-badge')
  ).toBeVisible()
  await detail.getByRole('button', { name: 'Close node detail' }).click()
  await shot(page, 'sidebar-outline')

  // Dependencies tab: one bar per node.
  await page.getByTestId('graph-tab-dependencies').click()
  const deps = page.getByTestId('graph-dependencies')
  await expect(deps).toBeVisible()
  await expect(deps.getByTestId('dependency-bar')).not.toHaveCount(0)
  await expect(
    deps.getByTestId('dependency-bar').filter({ hasText: 'Build' })
  ).toBeVisible()
  await expect(
    deps.getByTestId('dependency-bar').filter({ hasText: 'Design' })
  ).toBeVisible()
  await shot(page, 'dependencies')
})

test('an outside edit of the YAML file shows without reload', async ({
  page,
}) => {
  const { a } = readEnv()
  await openWithSidebar(page)
  await openGraph(page, 'E2E roadmap')
  await expect(nodeRow(page, 'Build')).toBeVisible()

  const before = readFileSync(state.roadmapPath, 'utf8')
  // A different mtime second: the poller compares mtimes.
  await new Promise(done => setTimeout(done, 1100))
  writeFileSync(
    state.roadmapPath,
    before.replace(/title: Build\n/, 'title: Build (edited outside)\n')
  )
  await expect(nodeRow(page, 'Build (edited outside)')).toBeVisible({
    timeout: 10_000,
  })
  // Put the title back for the next scenarios.
  await new Promise(done => setTimeout(done, 1100))
  writeFileSync(state.roadmapPath, before)
  await expect(nodeRow(page, 'Build (edited outside)')).toBeHidden({
    timeout: 10_000,
  })
  await expect(nodeRow(page, 'Build')).toBeVisible()
})

test('a manage agent changes the graph through MCP; review, revert, accept', async ({
  page,
}) => {
  const { a } = readEnv()
  state.agentName = uniqueName('Vision keeper')
  await openWithSidebar(page)

  // Settings → Agents: a new manage profile.
  // Command palette → "Edit Agents…" opens Settings → Agents.
  await runCommand(page, 'Edit Agents…')
  const pane = page.getByTestId('agents-pane')
  await expect(pane).toBeVisible()
  await pane.getByRole('button', { name: 'New agent' }).click()
  await pane.getByLabel('Name').fill(state.agentName)
  await pane.getByLabel('Persona prompt').fill('Keeps the roadmap honest.')
  await pane.getByRole('radio', { name: 'manage' }).click()
  await pane.getByRole('button', { name: 'Save' }).click()
  await expect(
    pane.getByRole('button', { name: new RegExp(state.agentName) })
  ).toContainText('manage')
  await shot(page, 'agents-pane')

  const prefs = await api<{
    agent_profiles: { id: string; name: string; permission: string }[]
  }>(a, 'load_preferences')
  const agent = prefs.agent_profiles.find(p => p.name === state.agentName)
  expect(agent?.permission).toBe('manage')

  // "Start session…" on the profile opens the Start session from agent dialog.
  await pane.getByRole('button', { name: 'Start session…' }).click()
  const start = page
    .getByRole('dialog')
    .filter({ hasText: 'Start session from agent' })
  await expect(start).toBeVisible()
  await expect(start.getByLabel('Agent', { exact: true })).toHaveValue(
    agent!.id
  )
  await start.getByLabel('Serves graph').selectOption({ label: 'E2E roadmap' })
  await expect(start.getByLabel('Serves node')).toHaveValue('')
  await expect(start.getByRole('radio', { name: 'manage' })).toBeChecked()
  await start.getByRole('button', { name: 'Start session' }).click()
  await expect(start).toBeHidden()

  // The new session carries agent, permission and serves.
  await expect(page.getByText(state.agentName).first()).toBeVisible()
  await expect
    .poll(() => agentSessionMetadata(a.data, state.agentName))
    .toMatchObject({
      agent_id: agent!.id,
      graph_permission: 'manage',
      serves: [state.roadmapId],
    })

  const design = nodeByTitle(state.roadmapPath, 'Design')
  const build = nodeByTitle(state.roadmapPath, 'Build')
  const milestone = nodeByTitle(state.roadmapPath, 'Milestone')
  const graphId = state.roadmapId
  await goToSession(page, state.agentName)
  await send(
    page,
    [
      `STUB:mcp create_node ${JSON.stringify({ graphId, title: 'Review UX', partOf: milestone.id, why: 'E2E why: UX needs a review pass' })}`,
      `STUB:mcp set_node_state ${JSON.stringify({ graphId, nodeId: design.id, state: 'done', why: 'E2E why: design signed off' })}`,
      `STUB:mcp send_request ${JSON.stringify({ graphId, nodeId: build.id, kind: 'accept-done', title: 'Build is finished', body: 'All parts shipped.', evidence: ['E2E evidence: tests pass'] })}`,
    ].join('\n')
  )

  // The file changed through the agent.
  await expectFile(state.roadmapPath, () => {
    const nodes = readNodes(state.roadmapPath)
    return (
      nodes.some(
        n =>
          n.title === 'Review UX' &&
          n.block.includes(`part-of: ${milestone.id}`)
      ) && nodes.find(n => n.title === 'Design')?.state === 'done'
    )
  })

  // The graph view shows it: new node, Design done, Build unblocked.
  await openGraph(page, 'E2E roadmap')
  await expect(nodeRow(page, 'Review UX')).toBeVisible()
  await expect(
    nodeRow(page, 'Review UX').getByTestId('node-unseen-dot')
  ).toBeVisible()
  await expect(
    nodeRow(page, 'Design').getByTestId('node-state-chip')
  ).toHaveText(/done/)
  await expect(
    nodeRow(page, 'Build').getByTestId('node-blocked-badge')
  ).toBeHidden()
  await expect(
    graphRow(page, 'E2E roadmap').getByTestId('sidebar-graph-requests')
  ).toHaveText('1')

  // Review: the request and both changes, with session name and why.
  await page.getByTestId('graph-tab-review').click()
  const review = page.getByTestId('graph-review')
  const request = review
    .getByTestId('graph-request')
    .filter({ hasText: 'Build is finished' })
  await expect(request).toContainText(state.agentName)
  await expect(request).toContainText('E2E evidence: tests pass')
  const created = review
    .getByTestId('graph-change')
    .filter({ hasText: 'E2E why: UX needs a review pass' })
  const stateChange = review
    .getByTestId('graph-change')
    .filter({ hasText: 'E2E why: design signed off' })
  await expect(created).toContainText(state.agentName)
  await expect(stateChange).toContainText(state.agentName)
  await shot(page, 'review')

  // Revert the state change: Design goes back to committed.
  await stateChange.getByRole('button', { name: 'Revert' }).click()
  await expect(
    stateChange.getByRole('button', { name: 'reverted' })
  ).toBeVisible()
  await expectFile(
    state.roadmapPath,
    () => nodeByTitle(state.roadmapPath, 'Design').state === 'committed'
  )

  // Accept the accept-done request: Build becomes done.
  await request.getByRole('button', { name: 'Accept (→ done)' }).click()
  await expectFile(
    state.roadmapPath,
    () => nodeByTitle(state.roadmapPath, 'Build').state === 'done'
  )
  await expect(
    review.getByTestId('graph-request').filter({ hasText: 'Build is finished' })
  ).toBeHidden()
  await page.getByTestId('graph-tab-outline').click()
  await expect(
    nodeRow(page, 'Build').getByTestId('node-state-chip')
  ).toHaveText(/done/)
  await expect(
    nodeRow(page, 'Design').getByTestId('node-state-chip')
  ).toHaveText(/committed/)
})

/** metadata.json of the session with this name, or null. */
function agentSessionMetadata(
  data: string,
  name: string
): Record<string, unknown> | null {
  const root = join(data, 'sessions/data')
  for (const id of existsSync(root) ? readdirSync(root) : []) {
    const path = join(root, id, 'metadata.json')
    if (!existsSync(path)) continue
    const meta = JSON.parse(readFileSync(path, 'utf8'))
    if (meta.name === name) return meta
  }
  return null
}

/** Every file of a session's data folder, concatenated (run logs, metadata). */
function readSessionFiles(dir: string): string {
  let all = ''
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) all += readSessionFiles(path)
    else all += readFileSync(path, 'utf8')
  }
  return all
}

test('a session without an agent only reads: create_node is refused', async ({
  page,
}) => {
  const { a, alphaA } = readEnv()
  const graphId = state.roadmapId
  // Created before the page loads: "Go to…" lists the sessions it loaded.
  const readerName = uniqueName('Reader')
  const readerId = await createSession(a, alphaA, readerName)
  await openWithSidebar(page)
  await goToSession(page, readerName)
  await send(
    page,
    `STUB:mcp create_node ${JSON.stringify({ graphId, title: 'Not allowed', why: 'E2E why: should fail' })}`
  )
  await waitForIdle(a, readerId)
  const runLog = readSessionFiles(join(a.data, 'sessions/data', readerId))
  expect(runLog).toContain(
    "create_node with state proposed needs graph permission 'write', but this session has 'read'"
  )
  expect(
    readNodes(state.roadmapPath).some(n => n.title === 'Not allowed')
  ).toBe(false)
})

test('the agent session shows its graph panel', async ({ page }) => {
  const { a } = readEnv()
  await openWithSidebar(page)
  await goToSession(page, state.agentName)
  const toggle = page.getByRole('button', { name: 'Toggle graph panel' })
  await expect(toggle).toBeVisible()
  const panel = page.getByTestId('session-graph-panel')
  if (!(await panel.isVisible())) await toggle.click()
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('serves the whole graph in')
  // Exact: the "Stop serving E2E roadmap (whole graph)" chip button also
  // matches once the graph list has loaded.
  await expect(
    panel.getByRole('button', { name: 'E2E roadmap', exact: true })
  ).toBeVisible()
  await expect(panel).toContainText('Review UX')
  await expect(panel.getByLabel('Graph permission')).toHaveValue('manage')
  await expect(panel).toContainText('E2E roadmap (whole graph)')
  await shot(page, 'session-graph-panel')
})

test('Commit graph commits only the graph file', async ({ page }) => {
  const { a } = readEnv()
  // An unrelated change in the same repo must stay uncommitted.
  const readme = join(state.repoPath, 'README.md')
  const original = readFileSync(readme, 'utf8')
  writeFileSync(readme, original + '\nUnrelated local edit.\n')
  const headBefore = git(state.repoPath, 'rev-parse', 'HEAD')

  try {
    await openWithSidebar(page)
    await openGraph(page, 'Alpha plan')
    await addNode(page, 'First step')
    await expectFile(state.planPath, text => text.includes('title: First step'))
    await page.getByRole('button', { name: 'Commit graph' }).click()
    await expect(page.getByText('Committed Alpha plan')).toBeVisible()

    expect(git(state.repoPath, 'rev-parse', 'HEAD^')).toBe(headBefore)
    expect(
      git(state.repoPath, 'show', '--name-only', '--format=', 'HEAD')
    ).toBe('.splitkick/graphs/alpha-plan.yml')
    expect(git(state.repoPath, 'status', '--porcelain')).toBe('M README.md')
  } finally {
    writeFileSync(readme, original)
  }
})
