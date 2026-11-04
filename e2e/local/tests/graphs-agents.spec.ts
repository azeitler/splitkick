import { expect, test, type Locator, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { join } from 'node:path'
import {
  api,
  createRepo,
  createSession,
  mcp,
  readEnv,
  seedProject,
  waitForIdle,
} from '../helpers'
import { REPO_ROOT, type Instance } from '../launcher'
import {
  chatInput,
  goToSession,
  openApp,
  openSessionMenu,
  runCommand,
  send,
  sessionTab,
} from './ui'

// Agents, permissions, MCP graph tools, requests, review, the session graph
// panel and agent badges of the graph layer (#79), end to end on instance A.
// Contract: docs/developer/graph-layer.md. The MCP tools run from real
// sessions through the stub CLI (`STUB:mcp …`), sent through the chat input;
// their results are read from the session's run log. `/api/invoke` and the
// MCP socket only set up state the scenario is not about (each such call
// says so): graphs, nodes, agent profiles and sessions that another test
// already makes through the UI.

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

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

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
/** Extra console errors a test expects (a refused command it provokes). */
let expectedConsole: RegExp[] = []

test.beforeEach(({ page }) => {
  consoleErrors = []
  expectedConsole = []
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', error => consoleErrors.push(`pageerror: ${error}`))
})

/** Graphs and agent profiles made by the test; removed after it (cleanup). */
const registered: string[] = []
const agentIds: string[] = []

test.afterEach(async () => {
  const { a } = readEnv()
  for (const id of registered.splice(0)) {
    await api(a, 'remove_graph', { graphId: id }).catch(() => undefined)
  }
  const ids = agentIds.splice(0)
  if (ids.length > 0) {
    const prefs = await api<Prefs>(a, 'load_preferences')
    await api(a, 'patch_preferences', {
      patch: {
        agent_profiles: (prefs.agent_profiles ?? []).filter(
          p => !ids.includes(p.id)
        ),
      },
    })
  }
  const allowed = [...ALLOWED_CONSOLE, ...expectedConsole]
  const unexpected = consoleErrors.filter(
    text => !allowed.some(re => re.test(text))
  )
  expect(unexpected, 'unexpected console errors').toEqual([])
})

// ---------------------------------------------------------------------------
// Agent profiles, sessions, metadata
// ---------------------------------------------------------------------------

interface Profile {
  id: string
  name: string
  color: string
  persona: string
  permission: 'read' | 'write' | 'manage'
  backend: string | null
  model: string | null
  default_serves: string | null
}

interface Prefs {
  agent_profiles?: Profile[]
}

/** Setup only: save an agent profile (Settings → Agents is test 1's job). */
async function addAgent(
  a: Instance,
  profile: Partial<Profile> & Pick<Profile, 'name' | 'permission'>
): Promise<Profile> {
  const full: Profile = {
    id: randomUUID(),
    color: '#3b82f6',
    persona: '',
    backend: null,
    model: null,
    default_serves: null,
    ...profile,
  }
  const prefs = await api<Prefs>(a, 'load_preferences')
  await api(a, 'patch_preferences', {
    patch: { agent_profiles: [...(prefs.agent_profiles ?? []), full] },
  })
  agentIds.push(full.id)
  return full
}

interface Meta {
  id: string
  name: string
  worktree_id: string
  backend?: string
  selected_model?: string | null
  agent_id?: string | null
  graph_permission?: string | null
  serves?: string[]
  started_by_session_id?: string | null
  forked_from_session_id?: string | null
  runs: { status: string }[]
}

const sessionsRoot = (a: Instance) => join(a.data, 'sessions/data')

function meta(a: Instance, sessionId: string): Meta {
  return JSON.parse(
    readFileSync(join(sessionsRoot(a), sessionId, 'metadata.json'), 'utf8')
  ) as Meta
}

/** Every session's metadata on disk. */
function allMeta(a: Instance): Meta[] {
  const root = sessionsRoot(a)
  const out: Meta[] = []
  for (const id of existsSync(root) ? readdirSync(root) : []) {
    const path = join(root, id, 'metadata.json')
    if (existsSync(path)) out.push(JSON.parse(readFileSync(path, 'utf8')))
  }
  return out
}

const sessionsNamed = (a: Instance, name: string) =>
  allMeta(a).filter(m => m.name === name)

/**
 * Setup only: a session with an agent, a permission and serves. The start
 * dialog that makes such sessions is test 2's subject.
 */
async function agentSession(
  a: Instance,
  name: string,
  opts: {
    agentId?: string
    permission?: 'read' | 'write' | 'manage'
    serves?: string[]
  } = {}
): Promise<string> {
  const { alphaA } = readEnv()
  const id = await createSession(a, alphaA, name)
  if (opts.agentId) {
    await api(a, 'set_session_agent', {
      sessionId: id,
      agentId: opts.agentId,
      permission: opts.permission ?? null,
    })
  }
  if (opts.serves) {
    await api(a, 'set_session_serves', { sessionId: id, serves: opts.serves })
  }
  return id
}

// ---------------------------------------------------------------------------
// Run logs: the MCP tool results a session got
// ---------------------------------------------------------------------------

interface ToolResult {
  tool: string
  input: Record<string, unknown>
  isError: boolean
  /** The error message, or the tool's text result. */
  text: string
}

/** Tool calls and results in a session's run logs, oldest run first. */
function toolResults(a: Instance, sessionId: string): ToolResult[] {
  const dir = join(sessionsRoot(a), sessionId)
  const runs = readdirSync(dir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => {
      const lines = readFileSync(join(dir, f), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(l => JSON.parse(l))
      return { started: Number(lines[0]?.started_at ?? 0), lines }
    })
    .sort((x, y) => x.started - y.started)
  const out: ToolResult[] = []
  const uses = new Map<
    string,
    { tool: string; input: Record<string, unknown> }
  >()
  for (const { lines } of runs) {
    for (const line of lines) {
      for (const block of line?.message?.content ?? []) {
        if (block.type === 'tool_use') {
          uses.set(block.id, {
            tool: String(block.name).split('__').at(-1)!,
            input: block.input,
          })
        } else if (block.type === 'tool_result') {
          const use = uses.get(block.tool_use_id)!
          let text = String(block.content)
          try {
            const value = JSON.parse(text)
            text = value?.error?.message ?? value?.content?.[0]?.text ?? text
          } catch {
            // plain text
          }
          out.push({ ...use, isError: Boolean(block.is_error), text })
        }
      }
    }
  }
  return out
}

const runFiles = (a: Instance, sessionId: string) =>
  readdirSync(join(sessionsRoot(a), sessionId)).filter(f =>
    f.endsWith('.jsonl')
  ).length

/**
 * Send a message in the open session and wait until its run has ended. Not
 * `send()`: after a turn with tool calls the earlier reply collapses into a
 * step summary, so counting reply paragraphs does not work for a second turn.
 */
async function sendAndWait(
  page: Page,
  a: Instance,
  sessionId: string,
  text: string
): Promise<void> {
  const before = runFiles(a, sessionId)
  await chatInput(page).fill(text)
  await page.keyboard.press('Enter')
  await expect.poll(() => runFiles(a, sessionId)).toBe(before + 1)
  await waitForIdle(a, sessionId)
  await expect(page.getByText(/^STUB REPLY/).last()).toBeVisible()
}

interface Call {
  tool: string
  args: Record<string, unknown>
  /** 'ok', or a text the refusal must contain. */
  expect: 'ok' | string
  label?: string
}

/**
 * Send all calls as `STUB:mcp` lines in one chat message (the open session),
 * wait for the turn to end and check each result against its expectation.
 */
async function runCalls(
  page: Page,
  a: Instance,
  sessionId: string,
  calls: Call[]
): Promise<ToolResult[]> {
  const before = toolResults(a, sessionId).length
  await sendAndWait(
    page,
    a,
    sessionId,
    calls.map(c => `STUB:mcp ${c.tool} ${JSON.stringify(c.args)}`).join('\n')
  )
  const results = toolResults(a, sessionId).slice(before)
  expect(results.map(r => r.tool)).toEqual(calls.map(c => c.tool))
  calls.forEach((call, i) => {
    const result = results[i]!
    const label = `${call.label ?? call.tool} → ${result.text.slice(0, 300)}`
    if (call.expect === 'ok') {
      expect(result.isError, label).toBe(false)
    } else {
      expect(result.isError, label).toBe(true)
      expect(result.text, label).toContain(call.expect)
    }
  })
  return results
}

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

const yamlNode = (path: string, id: string) =>
  readNodes(path).find(n => n.id === id)

/** Wait until node `id` on disk satisfies `check`. */
async function expectNode(
  path: string,
  id: string,
  check: (node: YamlNode | undefined) => boolean,
  message?: string
) {
  await expect
    .poll(() => check(yamlNode(path, id)), { message: message ?? id })
    .toBe(true)
}

interface Graph {
  id: string
  title: string
  path: string
}

/** Setup only: a new graph file in a folder (the dialog is graphs-files'). */
async function createGraph(a: Instance, title: string): Promise<Graph> {
  const path = join(a.root, `ga-${uid()}`, 'graph.yml')
  const g = await api<{ id: string }>(a, 'create_graph', {
    title,
    graphType: 'plan',
    path,
  })
  registered.push(g.id)
  return { id: g.id, title, path }
}

/** Setup only: add a node as the user (the outline is graphs-nodes'). */
async function addNode(
  a: Instance,
  graphId: string,
  title: string,
  extra: Record<string, unknown> = {}
): Promise<string> {
  const node = await api<{ id: string }>(a, 'create_graph_node', {
    graphId,
    node: { title, ...extra },
  })
  return node.id
}

interface Change {
  id: string
  nodeId: string | null
  action: string
  why: string | null
  seen: boolean
  actor: { kind: string; sessionId?: string }
  after: { state: string } | null
}

const changes = (a: Instance, graphId: string) =>
  api<Change[]>(a, 'list_graph_changes', { graphId })

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------

async function openWithSidebar(page: Page) {
  const { a } = readEnv()
  await openApp(page, a)
  const show = page.getByRole('button', { name: 'Show sidebar' })
  if (await show.isVisible()) await show.click()
  await expect(page.getByTestId('sidebar-graphs-section')).toBeAttached()
  const toggle = page.getByTestId('sidebar-graphs-toggle')
  if ((await toggle.getAttribute('aria-expanded')) === 'false') {
    await toggle.click()
  }
}

const graphRow = (page: Page, id: string) =>
  page.getByTestId(`sidebar-graph-row-${id}`)

async function openGraph(page: Page, g: Graph) {
  await graphRow(page, g.id).click()
  await expect(page.getByTestId('graph-title')).toHaveText(g.title)
}

const nodeRow = (page: Page, id: string) =>
  page.getByTestId(`graph-node-row-${id}`)

async function openNode(page: Page, id: string, title: string) {
  await nodeRow(page, id).click()
  const detail = page.getByTestId('graph-node-detail')
  await expect(detail.getByLabel('Node title')).toHaveValue(title)
  return detail
}

const agentsPane = (page: Page) => page.getByTestId('agents-pane')

/** The profile's row in the Settings → Agents list. */
const profileButton = (page: Page, name: string) =>
  agentsPane(page).getByRole('button', {
    name: new RegExp(`^${escapeRe(name)} (read|write|manage)$`),
  })

/** Close Settings with its close button (Escape needs focus inside it). */
async function closeSettings(page: Page) {
  await page
    .getByRole('dialog', { name: 'Settings' })
    .getByRole('button', { name: 'Close', exact: true })
    .click()
  await expect(agentsPane(page)).toBeHidden()
}

const startDialog = (page: Page) =>
  page.getByRole('dialog').filter({ hasText: 'Start session from agent' })

const graphPanel = (page: Page) => page.getByTestId('session-graph-panel')
const panelToggle = (page: Page) =>
  page.getByRole('button', { name: 'Toggle graph panel' })

async function showGraphPanel(page: Page): Promise<Locator> {
  await expect(panelToggle(page)).toBeVisible()
  if (!(await graphPanel(page).isVisible())) await panelToggle(page).click()
  await expect(graphPanel(page)).toBeVisible()
  return graphPanel(page)
}

/** The newest toast with this text (older ones may still be on screen). */
const toast = (page: Page, text: string | RegExp) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text }).last()

/** A session's row in the sidebar tree. */
const sidebarSession = (page: Page, sessionId: string) =>
  page.locator(`[data-sidebar-row-id="session:${sessionId}"]`)

// ===========================================================================
// 1. Settings → Agents
// ===========================================================================

test('agents pane: create, edit every field, save persists, duplicate, delete with confirm', async ({
  page,
}) => {
  const { a } = readEnv()
  const tag = uid()
  const g = await createGraph(a, `Agents pane ${tag}`) // setup
  const nodeId = await addNode(a, g.id, 'Served by default') // setup
  const name = `Planner ${tag}`

  await openWithSidebar(page)
  // Entry: command palette "Edit Agents…".
  await runCommand(page, 'Edit Agents…')
  const pane = agentsPane(page)
  await expect(pane).toBeVisible()
  await pane.getByRole('button', { name: 'New agent' }).click()
  // A new profile is saved at once as "New agent" and selected.
  await expect(pane.getByLabel('Name')).toHaveValue('New agent')

  // Empty name: Save stays disabled.
  await pane.getByLabel('Name').fill('   ')
  await expect(pane.getByRole('button', { name: 'Save' })).toBeDisabled()
  await pane.getByLabel('Name').fill(name)
  await expect(pane.getByRole('button', { name: 'Save' })).toBeEnabled()

  // Colour, persona, permission.
  await pane.getByRole('button', { name: 'Colour #a855f7' }).click()
  await expect(
    pane.getByRole('button', { name: 'Colour #a855f7' })
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    pane.getByRole('button', { name: 'Colour #f97316' })
  ).toHaveAttribute('aria-pressed', 'false')
  await pane.getByLabel('Persona prompt').fill(`Plans the work. E2E-${tag}`)
  await pane.getByRole('radio', { name: 'write' }).click()
  await expect(pane.getByRole('radio', { name: 'write' })).toBeChecked()

  // Backend and model: a backend with a model list offers it; changing the
  // backend resets the model; a backend without a list takes free text.
  const backend = pane.getByLabel('Default backend')
  const model = pane.getByLabel('Default model')
  await backend.selectOption('claude')
  await model.selectOption('claude-sonnet-5-5')
  await backend.selectOption('codex')
  await expect(model).toHaveValue('')
  await backend.selectOption('opencode')
  await expect(model).toHaveAttribute('placeholder', 'Session default')
  await model.fill('e2e/free-model')
  await backend.selectOption('claude')
  await expect(model).toHaveValue('')
  await model.selectOption('claude-sonnet-5-5')

  // Default serves: a graph, then one of its nodes.
  await pane.getByLabel('Serves graph').selectOption(g.id)
  await pane.getByLabel('Serves node').selectOption(nodeId)
  await shot(page, 'agents-pane')

  await pane.getByRole('button', { name: 'Save' }).click()
  await expect(pane.getByRole('button', { name: 'Save' })).toBeDisabled()
  await expect(profileButton(page, name)).toContainText('write')

  // preferences.json on disk holds the profile.
  const onDisk = () =>
    (
      JSON.parse(readFileSync(join(a.data, 'preferences.json'), 'utf8')) as {
        agent_profiles?: Profile[]
      }
    ).agent_profiles ?? []
  await expect.poll(() => onDisk().some(p => p.name === name)).toBe(true)
  const saved = onDisk().find(p => p.name === name)!
  agentIds.push(saved.id) // cleanup
  expect(saved).toEqual({
    id: expect.any(String),
    name,
    color: '#a855f7',
    persona: `Plans the work. E2E-${tag}`,
    permission: 'write',
    backend: 'claude',
    model: 'claude-sonnet-5-5',
    default_serves: `${g.id}#${nodeId}`,
  })
  // Unsaved "New agent" placeholders are not left behind by this flow.
  expect(onDisk().filter(p => p.id === saved.id)).toHaveLength(1)

  // A reload shows the same values.
  await page.reload()
  await expect(page.getByText('Go to…').first()).toBeVisible()
  await runCommand(page, 'Edit Agents…')
  await profileButton(page, name).click()
  await expect(pane.getByLabel('Name')).toHaveValue(name)
  await expect(pane.getByLabel('Persona prompt')).toHaveValue(
    `Plans the work. E2E-${tag}`
  )
  await expect(pane.getByRole('radio', { name: 'write' })).toBeChecked()
  await expect(
    pane.getByRole('button', { name: 'Colour #a855f7' })
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(backend).toHaveValue('claude')
  await expect(model).toHaveValue('claude-sonnet-5-5')
  await expect(pane.getByLabel('Serves graph')).toHaveValue(g.id)
  await expect(pane.getByLabel('Serves node')).toHaveValue(nodeId)
  await expect(pane.getByRole('button', { name: 'Save' })).toBeDisabled()

  // Duplicate: "<name> copy", selected, saved.
  await pane.getByRole('button', { name: 'Duplicate' }).click()
  await expect(pane.getByLabel('Name')).toHaveValue(`${name} copy`)
  await expect(profileButton(page, `${name} copy`)).toBeVisible()
  await expect
    .poll(() => onDisk().filter(p => p.name.startsWith(name)).length)
    .toBe(2)
  const copy = onDisk().find(p => p.name === `${name} copy`)!
  agentIds.push(copy.id) // cleanup
  expect({ ...copy, id: saved.id, name }).toEqual(saved)

  // Delete asks first; Cancel keeps the profile.
  await pane.getByRole('button', { name: 'Delete' }).click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toContainText(`Delete agent “${name} copy”?`)
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  await expect(confirm).toBeHidden()
  await expect(profileButton(page, `${name} copy`)).toBeVisible()
  expect(onDisk().some(p => p.id === copy.id)).toBe(true)

  await pane.getByRole('button', { name: 'Delete' }).click()
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(profileButton(page, `${name} copy`)).toHaveCount(0)
  await expect.poll(() => onDisk().some(p => p.id === copy.id)).toBe(false)
  expect(onDisk().some(p => p.id === saved.id)).toBe(true)
})

// ===========================================================================
// 2. Start session from agent
// ===========================================================================

test('start dialog: every entry point, permission cap, serves, place, first message not sent', async ({
  page,
}) => {
  const { a, alphaA } = readEnv()
  const tag = uid()
  const g = await createGraph(a, `Start ${tag}`) // setup
  const parent = await addNode(a, g.id, 'Parent node') // setup
  const worker = await addNode(a, g.id, 'Worker node', {
    relations: [{ kind: 'part-of', target: parent }],
  }) // setup
  const writer = await addAgent(a, {
    name: `Writer ${tag}`,
    permission: 'write',
    persona: 'Writes nodes.',
  }) // setup
  const manager = await addAgent(a, {
    name: `Manager ${tag}`,
    permission: 'manage',
    backend: 'claude',
    model: 'claude-sonnet-5-5',
    default_serves: `${g.id}#${parent}`,
  }) // setup

  // A second project with its own worktree, to pick in the dialog.
  const projectName = `agents-${tag}`
  const second = await seedProject(a, createRepo(a, projectName), `wt-${tag}`) // setup

  const known = new Set(allMeta(a).map(m => m.id))
  /** The one session started since the last call. */
  /**
   * The one agent session started since the last call. Opening a worktree
   * for the first time also makes its default session (no agent): skip it.
   */
  const newSession = async (): Promise<Meta> => {
    let found: Meta[] = []
    await expect
      .poll(() => {
        found = allMeta(a).filter(m => !known.has(m.id) && m.agent_id)
        return found.length
      })
      .toBe(1)
    for (const m of allMeta(a)) known.add(m.id)
    // The dialog writes agent, serves and model one after the other.
    await page.waitForTimeout(500)
    return meta(a, found[0]!.id)
  }

  await openWithSidebar(page)

  // --- Entry 1: graph header "Start session…" (serves the whole graph).
  await openGraph(page, g)
  await page
    .getByRole('button', { name: 'Start session…', exact: true })
    .click()
  let dialog = startDialog(page)
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Agent', { exact: true }).selectOption(writer.id)
  await expect(dialog.getByLabel('Serves graph')).toHaveValue(g.id)
  await expect(dialog.getByLabel('Serves node')).toHaveValue('')
  // The profile allows write: manage is disabled, write is preselected.
  await expect(dialog.getByRole('radio', { name: 'manage' })).toBeDisabled()
  await expect(dialog.getByRole('radio', { name: 'write' })).toBeChecked()
  await expect(dialog.getByRole('radio', { name: 'read' })).toBeEnabled()
  await expect(dialog).toContainText('The profile allows up to write')
  await expect(dialog).toContainText('Writes nodes.')
  // Lower it for this session.
  await dialog.getByRole('radio', { name: 'read' }).click()
  await expect(dialog.getByRole('radio', { name: 'read' })).toBeChecked()
  // Project and worktree: the graph has no project, so the first project
  // is preselected; pick the second one and its worktree.
  await dialog.getByLabel('Project', { exact: true }).selectOption({
    label: projectName,
  })
  await dialog
    .getByLabel('Worktree', { exact: true })
    .selectOption({ label: `wt-${tag}` })
  await dialog.getByLabel('First message').fill(`E2E first message ${tag}`)
  await shot(page, 'start-dialog')
  await dialog.getByRole('button', { name: 'Start session' }).click()
  await expect(dialog).toBeHidden()

  let m = await newSession()
  expect(m).toMatchObject({
    name: writer.name,
    agent_id: writer.id,
    graph_permission: 'read',
    serves: [g.id],
    worktree_id: second.worktreeId,
  })
  // The first message waits in the composer; nothing was sent.
  await expect(chatInput(page)).toHaveValue(`E2E first message ${tag}`)
  await page.waitForTimeout(1500)
  expect(meta(a, m.id).runs ?? []).toEqual([])
  await expect(page.locator('p', { hasText: /^STUB REPLY/ })).toHaveCount(0)
  await expect(page.getByTestId('session-agent-chip')).toContainText(
    `${writer.name}· read`
  )

  // --- Entry 2: node detail "Start session for this node…" preselects it.
  await openGraph(page, g)
  const detail = await openNode(page, worker, 'Worker node')
  await detail
    .getByRole('button', { name: 'Start session for this node…' })
    .click()
  dialog = startDialog(page)
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Agent', { exact: true }).selectOption(manager.id)
  // The node stays: a picked node wins over the agent's default serves.
  await expect(dialog.getByLabel('Serves graph')).toHaveValue(g.id)
  await expect(dialog.getByLabel('Serves node')).toHaveValue(worker)
  await expect(dialog.getByRole('radio', { name: 'manage' })).toBeChecked()
  await dialog.getByLabel('Project', { exact: true }).selectOption({
    label: 'alpha',
  })
  await dialog
    .getByLabel('Worktree', { exact: true })
    .selectOption({ label: 'feature-a' })
  for (const level of ['read', 'write', 'manage']) {
    await expect(dialog.getByRole('radio', { name: level })).toBeEnabled()
  }
  await dialog.getByRole('button', { name: 'Start session' }).click()
  await expect(dialog).toBeHidden()
  m = await newSession()
  expect(m).toMatchObject({
    name: manager.name,
    agent_id: manager.id,
    graph_permission: 'manage',
    serves: [`${g.id}#${worker}`],
    backend: 'claude',
    selected_model: 'claude-sonnet-5-5',
    worktree_id: alphaA.worktreeId,
  })
  await expect(chatInput(page)).toHaveValue('')

  // --- Entry 3: Settings → Agents "Start session…" takes the default serves.
  await runCommand(page, 'Edit Agents…')
  await profileButton(page, manager.name).click()
  await agentsPane(page).getByRole('button', { name: 'Start session…' }).click()
  dialog = startDialog(page)
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Agent', { exact: true })).toHaveValue(
    manager.id
  )
  await expect(dialog.getByLabel('Serves graph')).toHaveValue(g.id)
  await expect(dialog.getByLabel('Serves node')).toHaveValue(parent)
  await dialog.getByRole('button', { name: 'Start session' }).click()
  await expect(dialog).toBeHidden()
  m = await newSession()
  expect(m).toMatchObject({
    agent_id: manager.id,
    graph_permission: 'manage',
    serves: [`${g.id}#${parent}`],
  })

  // --- Entry 4: command palette. Switching the agent resets the level.
  await runCommand(page, 'Start Session from Agent…')
  dialog = startDialog(page)
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Agent', { exact: true }).selectOption(manager.id)
  await expect(dialog.getByLabel('Serves node')).toHaveValue(parent)
  await dialog.getByRole('radio', { name: 'write' }).click()
  await dialog.getByLabel('Agent', { exact: true }).selectOption(writer.id)
  // The writer has no default serves: "Nothing", and its own level.
  await expect(dialog.getByLabel('Serves graph')).toHaveValue('')
  await expect(dialog.getByLabel('Serves node')).toHaveCount(0)
  await expect(dialog.getByRole('radio', { name: 'write' })).toBeChecked()
  await expect(dialog.getByRole('radio', { name: 'manage' })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Start session' }).click()
  await expect(dialog).toBeHidden()
  m = await newSession()
  expect(m.agent_id).toBe(writer.id)
  expect(m.graph_permission).toBe('write')
  expect(m.serves ?? []).toEqual([])
  // No backend/model on the profile: the session default.
  expect(m.selected_model).not.toBe('claude-sonnet-5-5')
})

// ===========================================================================
// 3. Persona and graph context in the prompt
// ===========================================================================

test('persona and graph context reach the agent; plain sessions get none', async ({
  page,
}) => {
  const { a } = readEnv()
  const tag = uid().toUpperCase()
  const g = await createGraph(a, `Prompt ${tag}`) // setup
  const node = await addNode(a, g.id, `E2E-NODE-${tag}`) // setup
  const agent = await addAgent(a, {
    name: `Prompted ${tag}`,
    permission: 'write',
    persona: `You are careful. E2E-PERSONA-${tag}`,
  }) // setup
  const servedName = `Prompted session ${tag}`
  const served = await agentSession(a, servedName, {
    agentId: agent.id,
    permission: 'write',
    serves: [`${g.id}#${node}`],
  }) // setup
  const plainName = `Plain session ${tag}`
  const plain = await agentSession(a, plainName) // setup
  const combined = (id: string) =>
    join(a.data, 'combined-contexts', `${id}-combined.md`)

  await openWithSidebar(page)
  await goToSession(page, servedName)
  let reply = await send(page, 'Hello')
  expect(reply).toContain(`E2E-PERSONA-${tag}`)
  expect(reply).toContain(`E2E-NODE-${tag}`)
  // The stub saw them in the system prompt file Splitkick passes with
  // --append-system-prompt-file; it lives under the instance's temp root.
  expect(combined(served).startsWith(a.root)).toBe(true)
  const prompt = readFileSync(combined(served), 'utf8')
  expect(prompt).toContain(`You act as the Splitkick agent "${agent.name}".`)
  expect(prompt).toContain('## Splitkick graph')
  expect(prompt).toContain(
    `- node "E2E-NODE-${tag}" (${g.id}#${node}, proposed) in graph "${g.title}", file ${g.path}`
  )
  expect(prompt).toContain('Your graph permission is write.')
  expect(prompt).toContain('Give a short why for every change.')

  // No agent, no serves: no persona and no graph block.
  await goToSession(page, plainName)
  reply = await send(page, 'Hello')
  expect(reply).not.toContain('E2E-PERSONA')
  expect(reply).not.toContain('E2E-NODE')
  const plainPrompt = existsSync(combined(plain))
    ? readFileSync(combined(plain), 'utf8')
    : ''
  expect(plainPrompt).not.toContain('## Splitkick graph')
  expect(plainPrompt).not.toContain('You act as the Splitkick agent')

  // Edit the persona in Settings → Agents. The persona is read when a
  // message is sent: the existing session gets the new one from its next
  // message (documented in graph-layer.md and in the pane).
  await runCommand(page, 'Edit Agents…')
  await profileButton(page, agent.name).click()
  await expect(agentsPane(page)).toContainText(
    'Edits reach every session of this agent from its next message'
  )
  await agentsPane(page)
    .getByLabel('Persona prompt')
    .fill(`You are bold. E2E-PERSONA-${tag}-NEW`)
  await agentsPane(page).getByRole('button', { name: 'Save' }).click()
  await expect(
    agentsPane(page).getByRole('button', { name: 'Save' })
  ).toBeDisabled()
  await closeSettings(page)
  await goToSession(page, servedName)
  reply = await send(page, 'Again')
  expect(reply).toContain(`E2E-PERSONA-${tag}-NEW`)
  expect(readFileSync(combined(served), 'utf8')).not.toContain(
    'You are careful.'
  )
})

// ===========================================================================
// 4. MCP permission matrix
// ===========================================================================

type Level = 'none' | 'read' | 'write' | 'manage'
const RANK = { read: 0, write: 1, manage: 2 } as const

/** Every graph tool with every option, expected by the session's level. */
function matrixCalls(level: Level, g: Graph, target: string, other: string) {
  const have = level === 'none' ? 'read' : level
  const refused = (need: 'write' | 'manage', action: string) =>
    RANK[have] >= RANK[need]
      ? 'ok'
      : `${action} needs graph permission '${need}', but this session has '${have}'`
  const why = (text: string) => `E2E why: ${text}`
  const upd = (label: string, args: Record<string, unknown>): Call => ({
    tool: 'update_node',
    label: `update_node ${label}`,
    args: { graphId: g.id, nodeId: target, ...args, why: why(label) },
    expect: refused('write', 'update_node'),
  })
  const state = (s: string): Call => ({
    tool: 'set_node_state',
    label: `set_node_state ${s}`,
    args: { graphId: g.id, nodeId: other, state: s, why: why(`state ${s}`) },
    expect: refused(
      s === 'proposed' ? 'write' : 'manage',
      `set_node_state to ${s}`
    ),
  })
  const calls: Call[] = [
    { tool: 'list_graphs', args: {}, expect: 'ok' },
    { tool: 'read_graph', args: { graphId: g.id }, expect: 'ok' },
    {
      tool: 'create_node',
      label: 'create_node proposed',
      args: { graphId: g.id, title: 'Made proposed', why: why('proposed') },
      expect: refused('write', 'create_node with state proposed'),
    },
    {
      tool: 'create_node',
      label: 'create_node committed',
      args: {
        graphId: g.id,
        title: 'Made committed',
        state: 'committed',
        why: why('committed'),
      },
      expect: refused('manage', 'create_node with state committed'),
    },
    upd('title', { title: 'Target renamed' }),
    upd('description', { description: 'E2E description' }),
    upd('setProperties', { setProperties: { owner: 'ana', size: 'L' } }),
    upd('removeProperties', { removeProperties: ['owner'] }),
    upd('addRelations', {
      addRelations: [
        { kind: 'depends-on', target: other },
        { kind: 'relates-to', target: other },
      ],
    }),
    upd('removeRelations', {
      removeRelations: [{ kind: 'relates-to', target: other }],
    }),
    upd('addAttachments', {
      addAttachments: [
        { kind: 'note', value: 'E2E note' },
        { kind: 'issue', value: 'azeitler/splitkick#1' },
      ],
    }),
    upd('removeAttachments', {
      removeAttachments: [{ kind: 'issue', value: 'azeitler/splitkick#1' }],
    }),
    // `other` starts committed, so each step is a real change.
    ...(level === 'manage'
      ? ['done', 'dropped', 'proposed', 'committed']
      : ['proposed', 'committed', 'done', 'dropped']
    ).map(state),
    {
      tool: 'send_request',
      label: 'send_request accept-done',
      args: {
        graphId: g.id,
        nodeId: target,
        kind: 'accept-done',
        title: `Done? (${level})`,
        evidence: ['E2E evidence'],
      },
      expect: refused('write', 'send_request'),
    },
    {
      tool: 'send_request',
      label: 'send_request decision',
      args: {
        graphId: g.id,
        nodeId: target,
        kind: 'decision',
        title: `Which? (${level})`,
        options: ['One', 'Two'],
      },
      expect: refused('write', 'send_request'),
    },
    {
      tool: 'set_serves',
      label: 'set_serves node',
      args: { serves: [`${g.id}#${target}`] },
      expect: 'ok',
    },
    {
      tool: 'set_serves',
      label: 'set_serves invalid node',
      args: { serves: [`${g.id}#nope00`] },
      expect: `Invalid serves ref '${g.id}#nope00': graph "${g.title}" has no node nope00`,
    },
    {
      tool: 'set_serves',
      label: 'set_serves unknown graph',
      args: { serves: [`no-such-graph-${level}`] },
      expect: `Invalid serves ref 'no-such-graph-${level}'`,
    },
    {
      tool: 'set_serves',
      label: 'set_serves whole graph',
      args: { serves: [g.id] },
      expect: 'ok',
    },
  ]
  if (level === 'manage') {
    const whyRequired = "'why' is required"
    calls.push(
      {
        tool: 'create_node',
        label: 'create_node without why',
        args: { graphId: g.id, title: 'No why' },
        expect: whyRequired,
      },
      {
        tool: 'update_node',
        label: 'update_node blank why',
        args: { graphId: g.id, nodeId: target, title: 'No why', why: '  ' },
        expect: whyRequired,
      },
      {
        tool: 'set_node_state',
        label: 'set_node_state without why',
        args: { graphId: g.id, nodeId: target, state: 'done' },
        expect: whyRequired,
      }
    )
  }
  return calls
}

test('MCP permission matrix: none, read, write, manage; raising the level in the panel', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const { a } = readEnv()
  const tag = uid()
  const reader = await addAgent(a, {
    name: `Reader ${tag}`,
    permission: 'read',
  }) // setup
  const writer = await addAgent(a, {
    name: `Writer ${tag}`,
    permission: 'write',
  }) // setup
  const boss = await addAgent(a, { name: `Boss ${tag}`, permission: 'manage' }) // setup

  const levels: { level: Level; agent?: Profile }[] = [
    { level: 'none' },
    { level: 'read', agent: reader },
    { level: 'write', agent: writer },
    { level: 'manage', agent: boss },
  ]
  const setups = []
  for (const { level, agent } of levels) {
    const g = await createGraph(a, `Matrix ${level} ${tag}`) // setup
    const target = await addNode(a, g.id, 'Target') // setup
    const other = await addNode(a, g.id, 'Other', { state: 'committed' }) // setup
    const name = `Matrix ${level} ${tag}`
    // No graph_permission on the session: the agent's level applies.
    const sessionId = await agentSession(a, name, { agentId: agent?.id }) // setup
    setups.push({ level, g, target, other, name, sessionId })
  }

  await openWithSidebar(page)
  for (const s of setups) {
    const fileBefore = readFileSync(s.g.path, 'utf8')
    const changesBefore = (await changes(a, s.g.id)).length
    await goToSession(page, s.name)
    const results = await runCalls(
      page,
      a,
      s.sessionId,
      matrixCalls(s.level, s.g, s.target, s.other)
    )

    // Reads return the graph.
    expect(
      JSON.parse(results[0]!.text).graphs.map((x: Graph) => x.id)
    ).toContain(s.g.id)
    expect(
      JSON.parse(results[1]!.text).nodes.map((n: { id: string }) => n.id)
    ).toEqual([s.target, s.other])
    // set_serves: the last valid call wins, the refused ones change nothing.
    expect(meta(a, s.sessionId).serves).toEqual([s.g.id])

    const requests = await api<{ title: string; status: string }[]>(
      a,
      'list_graph_requests',
      { graphId: s.g.id }
    )
    const log = await changes(a, s.g.id)
    if (s.level === 'none' || s.level === 'read') {
      // Every write was refused: the file, the log and the requests are as
      // before.
      expect(readFileSync(s.g.path, 'utf8')).toBe(fileBefore)
      expect(log).toHaveLength(changesBefore)
      expect(requests).toEqual([])
      if (s.level === 'read') await shot(page, 'permission-refusal')
      continue
    }

    const titles = readNodes(s.g.path).map(n => n.title)
    expect(titles).toContain('Made proposed')
    expect(titles.includes('Made committed')).toBe(s.level === 'manage')
    if (s.level === 'manage') {
      expect(
        readNodes(s.g.path).find(n => n.title === 'Made committed')!.state
      ).toBe('committed')
    }
    expect(yamlNode(s.g.path, s.target)).toEqual({
      id: s.target,
      title: 'Target renamed',
      state: 'proposed',
      description: 'E2E description',
      properties: [['size', 'L']],
      relations: [['depends-on', s.other]],
      attachments: [['note', 'E2E note']],
    })
    // write: only `proposed` passed; manage: done → dropped → proposed → committed.
    expect(yamlNode(s.g.path, s.other)!.state).toBe(
      s.level === 'manage' ? 'committed' : 'proposed'
    )
    const stateLog = log
      .filter(c => c.action === 'node.state' && c.nodeId === s.other)
      .reverse()
      .map(c => c.after?.state)
    expect(stateLog).toEqual(
      s.level === 'manage'
        ? ['done', 'dropped', 'proposed', 'committed']
        : ['proposed']
    )
    const updates = log.filter(
      c => c.action === 'node.update' && c.nodeId === s.target
    )
    expect(updates).toHaveLength(8)
    for (const c of updates) {
      expect(c.why).toMatch(/^E2E why: /)
      expect(c.actor).toMatchObject({ kind: 'session', sessionId: s.sessionId })
    }
    expect(requests.map(r => r.title).sort()).toEqual(
      [`Done? (${s.level})`, `Which? (${s.level})`].sort()
    )
    if (s.level === 'manage') {
      // Refused for the missing why: no "No why" anywhere.
      expect(readFileSync(s.g.path, 'utf8')).not.toContain('No why')
      expect(yamlNode(s.g.path, s.target)!.state).toBe('proposed')
    }
  }

  // Raise the read session to write in its graph panel: create_node passes.
  const read = setups.find(s => s.level === 'read')!
  await goToSession(page, read.name)
  const panel = await showGraphPanel(page)
  await expect(panel.getByLabel('Graph permission')).toHaveValue('read')
  await panel.getByLabel('Graph permission').selectOption('write')
  await expect
    .poll(() => meta(a, read.sessionId).graph_permission)
    .toBe('write')
  await runCalls(page, a, read.sessionId, [
    {
      tool: 'create_node',
      args: { graphId: read.g.id, title: 'Raised', why: 'E2E why: raised' },
      expect: 'ok',
    },
  ])
  expect(readNodes(read.g.path).map(n => n.title)).toContain('Raised')

  // A caller that is not a session (MCP source "anon") only reads. No UI
  // makes such a call: the socket directly.
  const before = readFileSync(read.g.path, 'utf8')
  await expect(
    mcp(a, 'anon', 'read_graph', { graphId: read.g.id })
  ).resolves.toBeTruthy()
  await expect(
    mcp(a, 'anon', 'create_node', {
      graphId: read.g.id,
      title: 'Anon',
      why: 'E2E why: anon',
    })
  ).rejects.toThrow(
    "create_node with state proposed needs graph permission 'write', but this session has 'read'"
  )
  await expect(
    mcp(a, 'anon', 'set_serves', { serves: [read.g.id] })
  ).rejects.toThrow('set_serves only works from a Splitkick session')
  expect(readFileSync(read.g.path, 'utf8')).toBe(before)
})

// ===========================================================================
// 5. MCP create_session with serves and agentId
// ===========================================================================

test('MCP create_session: agent, permission and serves from a manage session; refusals', async ({
  page,
}) => {
  const { a, alphaA } = readEnv()
  const tag = uid()
  const g = await createGraph(a, `Spawn ${tag}`) // setup
  const node = await addNode(a, g.id, 'Spawned work') // setup
  const writer = await addAgent(a, {
    name: `Worker ${tag}`,
    permission: 'write',
  }) // setup
  const boss = await addAgent(a, { name: `Lead ${tag}`, permission: 'manage' }) // setup
  const bossName = `Lead session ${tag}`
  const bossId = await agentSession(a, bossName, { agentId: boss.id }) // setup
  const writerName = `Worker session ${tag}`
  const writerId = await agentSession(a, writerName, { agentId: writer.id }) // setup
  const child = `Spawned ${tag}`
  const ghost = `Ghost agent ${tag}`
  const badServes = `Bad serves ${tag}`
  const refused = `Refused ${tag}`

  await openWithSidebar(page)
  await goToSession(page, bossName)
  await runCalls(page, a, bossId, [
    {
      tool: 'create_session',
      args: {
        worktreeId: alphaA.worktreeId,
        name: child,
        agentId: writer.id,
        serves: [`${g.id}#${node}`],
      },
      expect: 'ok',
    },
    {
      tool: 'create_session',
      args: {
        worktreeId: alphaA.worktreeId,
        name: ghost,
        agentId: `ghost-${tag}`,
      },
      expect: `Unknown agentId: ghost-${tag}`,
    },
    {
      tool: 'create_session',
      args: {
        worktreeId: alphaA.worktreeId,
        name: badServes,
        serves: [`${g.id}#nope00`],
      },
      expect: `Invalid serves ref '${g.id}#nope00'`,
    },
  ])
  await expect(page.getByText(`Started session ‘${child}’`)).toBeVisible()
  const [spawned] = sessionsNamed(a, child)
  expect(spawned).toMatchObject({
    agent_id: writer.id,
    graph_permission: 'write',
    serves: [`${g.id}#${node}`],
    started_by_session_id: bossId,
  })
  expect(sessionsNamed(a, ghost)).toEqual([])
  expect(sessionsNamed(a, badServes)).toEqual([])

  // A write session may not start agent sessions. The spawned session opens
  // a moment after the call; wait for it, or it takes over after we switch.
  await expect(sessionTab(page, child)).toBeVisible()
  await goToSession(page, writerName)
  await runCalls(page, a, writerId, [
    {
      tool: 'create_session',
      args: {
        worktreeId: alphaA.worktreeId,
        name: refused,
        agentId: writer.id,
      },
      expect:
        "create_session with agentId needs graph permission 'manage', but this session has 'write'",
    },
  ])
  expect(sessionsNamed(a, refused)).toEqual([])
})

// ===========================================================================
// 6. Requests in Review
// ===========================================================================

test('requests: accept, send back with note, decision options, other answer, no blocker, deleted requester', async ({
  page,
}) => {
  const { a, alphaA } = readEnv()
  const tag = uid()
  const g = await createGraph(a, `Requests ${tag}`) // setup
  const d1 = await addNode(a, g.id, 'Ship it') // setup
  const d2 = await addNode(a, g.id, 'Polish it') // setup
  const n3 = await addNode(a, g.id, 'Store data', {
    relations: [{ kind: 'blocked-by', target: 'decision: which db' }],
  }) // setup
  const n4 = await addNode(a, g.id, 'Host it', {
    relations: [{ kind: 'blocked-by', target: 'decision: hosting' }],
  }) // setup
  const n5 = await addNode(a, g.id, 'Name it') // setup
  const writer = await addAgent(a, {
    name: `Asker ${tag}`,
    permission: 'write',
  }) // setup
  const askerName = `Asker session ${tag}`
  const askerId = await agentSession(a, askerName, { agentId: writer.id }) // setup
  // A request whose session is gone: made over the socket as that session,
  // then the session is deleted (close_session removes its data).
  const ghostName = `Gone session ${tag}`
  const ghostId = await agentSession(a, ghostName, { agentId: writer.id }) // setup
  await mcp(a, ghostId, 'send_request', {
    graphId: g.id,
    nodeId: d2,
    kind: 'accept-done',
    title: 'From a gone session',
  }) // setup
  await api(a, 'close_session', {
    worktreeId: alphaA.worktreeId,
    worktreePath: alphaA.worktreePath,
    sessionId: ghostId,
  }) // setup
  expect(existsSync(join(sessionsRoot(a), ghostId, 'metadata.json'))).toBe(
    false
  )

  await openWithSidebar(page)
  await goToSession(page, askerName)
  const req = (args: Record<string, unknown>): Call => ({
    tool: 'send_request',
    args: { graphId: g.id, ...args },
    expect: 'ok',
  })
  await runCalls(page, a, askerId, [
    req({
      nodeId: d1,
      kind: 'accept-done',
      title: 'Ship is done',
      body: 'Shipped.',
      evidence: ['E2E evidence: green'],
    }),
    req({ nodeId: d2, kind: 'accept-done', title: 'Polish is done' }),
    req({
      nodeId: n3,
      kind: 'decision',
      title: 'Pick a database',
      options: ['Postgres', 'SQLite'],
      blocker: 'decision: which db',
    }),
    req({
      nodeId: n4,
      kind: 'decision',
      title: 'Pick hosting',
      options: ['Cloud'],
      blocker: 'decision: hosting',
    }),
    req({
      nodeId: n5,
      kind: 'decision',
      title: 'Name it?',
      options: ['Keep it'],
    }),
  ])

  const counts = async (n: number) => {
    const sidebar = graphRow(page, g.id).getByTestId('sidebar-graph-requests')
    const tab = page.getByTestId('graph-tab-review')
    if (n === 0) {
      await expect(sidebar).toHaveCount(0)
      await expect(tab).toHaveText('Review')
    } else {
      await expect(sidebar).toHaveText(String(n))
      await expect(tab).toHaveText(`Review${n}`)
    }
  }

  await openGraph(page, g)
  await expect(
    nodeRow(page, n3).getByTestId('node-blocked-badge')
  ).toBeVisible()
  await expect(
    nodeRow(page, n4).getByTestId('node-blocked-badge')
  ).toBeVisible()
  await counts(6)
  await page.getByTestId('graph-tab-review').click()
  const review = page.getByTestId('graph-review')
  const card = (title: string) =>
    review.getByTestId('graph-request').filter({ hasText: title })
  await expect(review.getByTestId('graph-request')).toHaveCount(6)

  // The request of a deleted session still renders, with its name.
  await expect(card('From a gone session')).toContainText(ghostName)
  await expect(card('Ship is done')).toContainText(askerName)
  await expect(card('Ship is done')).toContainText('E2E evidence: green')
  await expect(card('Pick a database')).toContainText('resolves blocked-by on')

  // Accept → done.
  await card('Ship is done')
    .getByRole('button', { name: 'Accept (→ done)' })
    .click()
  await expectNode(g.path, d1, n => n?.state === 'done')
  await expect(card('Ship is done')).toHaveCount(0)
  await counts(5)

  // Send back needs a note; the state stays.
  await card('Polish is done')
    .getByRole('button', { name: 'Send back with note…' })
    .click()
  const sendBack = card('Polish is done').getByRole('button', {
    name: 'Send back',
    exact: true,
  })
  await expect(sendBack).toBeDisabled()
  await card('Polish is done').getByLabel('Note for the session').fill('   ')
  await expect(sendBack).toBeDisabled()
  await card('Polish is done')
    .getByLabel('Note for the session')
    .fill('E2E note: add tests')
  await sendBack.click()
  await expect(card('Polish is done')).toHaveCount(0)
  await counts(4)
  expect(yamlNode(g.path, d2)!.state).toBe('proposed')

  // Decision with options: the option resolves the blocker.
  await card('Pick a database').getByRole('button', { name: 'SQLite' }).click()
  await expectNode(
    g.path,
    n3,
    n =>
      !!n &&
      n.relations.length === 0 &&
      n.attachments.some(
        ([k, v]) =>
          k === 'note' && v === 'Decision: decision: which db → SQLite'
      )
  )
  await counts(3)

  // "Other answer…": free text.
  await card('Pick hosting')
    .getByRole('button', { name: 'Other answer…' })
    .click()
  const answer = card('Pick hosting').getByRole('button', {
    name: 'Answer',
    exact: true,
  })
  await expect(answer).toBeDisabled()
  await card('Pick hosting').getByLabel('Your answer').fill('E2E self-hosted')
  await answer.click()
  await expectNode(
    g.path,
    n4,
    n =>
      !!n &&
      n.relations.length === 0 &&
      n.attachments.some(
        ([, v]) => v === 'Decision: decision: hosting → E2E self-hosted'
      )
  )
  await counts(2)

  // A decision without a blocker: the question is its title.
  await card('Name it?').getByRole('button', { name: 'Keep it' }).click()
  await expectNode(
    g.path,
    n5,
    n => !!n?.attachments.some(([, v]) => v === 'Decision: Name it? → Keep it')
  )
  expect(yamlNode(g.path, n5)!.relations).toEqual([])
  await counts(1)
  await shot(page, 'decision-answered')

  // The gone session's request: sending it back works without its session.
  await card('From a gone session')
    .getByRole('button', { name: 'Send back with note…' })
    .click()
  await card('From a gone session')
    .getByLabel('Note for the session')
    .fill('E2E nobody reads this')
  await card('From a gone session')
    .getByRole('button', { name: 'Send back', exact: true })
    .click()
  await counts(0)
  await expect(review).toContainText('Nothing waits for you.')

  // Answered: collapsed, dimmed, with the answer.
  const answered = page.getByTestId('answered-requests')
  await expect(answered).not.toHaveAttribute('open', '')
  await expect(answered.locator('summary')).toHaveText('Answered (6)')
  await expect(answered.locator('li').first()).toBeHidden()
  await answered.locator('summary').click()
  await expect(answered.locator('ul')).toHaveClass(/opacity-60/)
  const row = (title: string) =>
    answered.locator('li').filter({ hasText: title })
  await expect(row('Ship is done')).toContainText('accepted')
  await expect(row('Polish is done')).toContainText(
    'sent-back · E2E note: add tests'
  )
  await expect(row('Pick a database')).toContainText('answered · SQLite')
  await expect(row('Pick hosting')).toContainText('answered · E2E self-hosted')
  await expect(row('Name it?')).toContainText('answered · Keep it')
  await expect(row('From a gone session')).toContainText('sent-back')

  // The outline: both decisions unblocked their nodes.
  await page.getByTestId('graph-tab-outline').click()
  await expect(nodeRow(page, n3).getByTestId('node-blocked-badge')).toHaveCount(
    0
  )
  await expect(nodeRow(page, n4).getByTestId('node-blocked-badge')).toHaveCount(
    0
  )

  // The requesting session got the note and the decisions as follow-ups.
  await goToSession(page, askerName)
  await expect(page.getByTestId('follow-ups-badge')).toHaveText('4')
  await page.getByRole('button', { name: /^Follow-ups/ }).click()
  const followUps = page.getByLabel('Follow-up items')
  await expect(followUps).toContainText(
    'Graph request "Polish is done" was sent back: E2E note: add tests'
  )
  await expect(followUps).toContainText('Decision "decision: which db": SQLite')
  await expect(followUps).toContainText(
    'Decision "decision: hosting": E2E self-hosted'
  )
  await expect(followUps).toContainText('Decision "Name it?": Keep it')
  await shot(page, 'send-back-follow-up')
})

// ===========================================================================
// 7. Review: changes
// ===========================================================================

test('review changes: unseen by node, Seen, Mark all seen, own changes, revert, refused revert, create and delete', async ({
  page,
}) => {
  const { a } = readEnv()
  const tag = uid()
  const g = await createGraph(a, `Changes ${tag}`) // setup
  const x = await addNode(a, g.id, 'Node X') // setup
  const y = await addNode(a, g.id, 'Node Y') // setup
  const z = await addNode(a, g.id, 'Node Z') // setup
  const k = await addNode(a, g.id, 'Node K') // setup
  const writer = await addAgent(a, {
    name: `Changer ${tag}`,
    permission: 'write',
  }) // setup
  const agentName = `Changer session ${tag}`
  const agentId = await agentSession(a, agentName, { agentId: writer.id }) // setup

  await openWithSidebar(page)
  // The user's own setup changes are seen already.
  expect((await changes(a, g.id)).every(c => c.seen)).toBe(true)
  await goToSession(page, agentName)
  const why = (t: string) => `E2E why: ${t}`
  const [created] = await runCalls(page, a, agentId, [
    {
      tool: 'create_node',
      args: { graphId: g.id, title: 'Agent made', why: why('create') },
      expect: 'ok',
    },
    {
      tool: 'update_node',
      args: { graphId: g.id, nodeId: x, title: 'X by agent', why: why('x') },
      expect: 'ok',
    },
    {
      tool: 'update_node',
      args: { graphId: g.id, nodeId: y, description: 'one', why: why('y1') },
      expect: 'ok',
    },
    {
      tool: 'update_node',
      args: { graphId: g.id, nodeId: y, description: 'two', why: why('y2') },
      expect: 'ok',
    },
  ])
  const madeId = JSON.parse(created!.text).id as string

  await openGraph(page, g)
  const unseenCount = graphRow(page, g.id).getByTestId('sidebar-graph-unseen')
  await expect(unseenCount).toHaveText('4')

  // The user's own change (rename in the detail) is never unseen.
  let detail = await openNode(page, k, 'Node K')
  await detail.getByLabel('Node title').fill('K by user')
  await detail.getByLabel('Node title').press('Enter')
  await expectNode(g.path, k, n => n?.title === 'K by user')
  await detail.getByRole('button', { name: 'Close node detail' }).click()

  await page.getByTestId('graph-tab-review').click()
  const review = page.getByTestId('graph-review')
  const groups = review.getByTestId('unseen-group')
  const group = (title: string) => groups.filter({ hasText: title })
  const change = (text: string) =>
    review.getByTestId('graph-change').filter({ hasText: text })
  await expect(groups).toHaveCount(3)
  await expect(group('Agent made')).toContainText('1 change')
  await expect(group('X by agent')).toContainText('1 change')
  await expect(group('Node Y')).toContainText('2 changes')
  await expect(review).toContainText('Changes since you last looked4')
  await expect(unseenCount).toHaveText('4')
  await expect(change(why('y2'))).toContainText(agentName)
  // Below the line: the user's rename, as "You".
  await expect(review.getByText('seen', { exact: true })).toBeVisible()
  await expect(change('Renamed "Node K" to "K by user"')).toContainText('You')
  await shot(page, 'review-changes')

  // Per-node Seen.
  await group('X by agent').getByRole('button', { name: 'Seen' }).click()
  await expect(groups).toHaveCount(2)
  await expect(unseenCount).toHaveText('3')
  await expect(change(why('x'))).toContainText('X by agent: ')

  // Revert succeeds; the change shows "reverted" and is no longer unseen.
  await change(why('y2')).getByRole('button', { name: 'Revert' }).click()
  await expect(
    change(why('y2')).getByRole('button', { name: 'reverted' })
  ).toBeDisabled()
  await expectNode(g.path, y, n => n?.description === 'one')
  await expect(unseenCount).toHaveText('2')
  await expect(group('Node Y')).toContainText('1 change')

  // Revert refused: the user changed X after the agent did.
  await page.getByTestId('graph-tab-outline').click()
  detail = await openNode(page, x, 'X by agent')
  await detail.getByLabel('Node title').fill('X by user')
  await detail.getByLabel('Node title').press('Enter')
  await expectNode(g.path, x, n => n?.title === 'X by user')
  await detail.getByRole('button', { name: 'Close node detail' }).click()
  await page.getByTestId('graph-tab-review').click()
  expectedConsole.push(/Cannot revert: node/)
  await change(why('x')).getByRole('button', { name: 'Revert' }).click()
  await expect(toast(page, 'Could not revert the change')).toContainText(
    `Cannot revert: node ${x} changed after this change`
  )
  await expect(
    change(why('x')).getByRole('button', { name: 'Revert' })
  ).toBeEnabled()
  expect(yamlNode(g.path, x)!.title).toBe('X by user')

  // Revert a create: the node goes.
  await change(why('create')).getByRole('button', { name: 'Revert' }).click()
  await expect
    .poll(() => readNodes(g.path).some(n => n.id === madeId))
    .toBe(false)
  await expect(
    change(why('create')).getByRole('button', { name: 'reverted' })
  ).toBeVisible()
  await expect(unseenCount).toHaveText('1')

  // Revert a delete: the node comes back.
  await page.getByTestId('graph-tab-outline').click()
  detail = await openNode(page, z, 'Node Z')
  await detail.getByRole('button', { name: 'Delete node' }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete', exact: true })
    .click()
  await expect.poll(() => yamlNode(g.path, z)).toBeUndefined()
  await page.getByTestId('graph-tab-review').click()
  await expect(change('Deleted "Node Z"')).toContainText('You')
  await change('Deleted "Node Z"')
    .getByRole('button', { name: 'Revert' })
    .click()
  await expectNode(g.path, z, n => n?.title === 'Node Z')

  // Mark all seen: nothing new, the sidebar count goes.
  await review.getByRole('button', { name: 'Mark all seen' }).click()
  await expect(review).toContainText('Nothing new.')
  await expect(
    review.getByRole('button', { name: 'Mark all seen' })
  ).toBeDisabled()
  await expect(unseenCount).toHaveCount(0)
  expect((await changes(a, g.id)).every(c => c.seen)).toBe(true)
  // The seen list holds the recent changes, newest first.
  await expect(review.getByTestId('graph-change').first()).toContainText(
    'Reverted'
  )
})

// ===========================================================================
// 8. Session graph panel
// ===========================================================================

test('session graph panel: hidden without agent and serves, worker, manager, two graphs, toggle state', async ({
  page,
}) => {
  const { a } = readEnv()
  const tag = uid()
  const g = await createGraph(a, `Panel ${tag}`) // setup
  const p = await addNode(a, g.id, 'Phase') // setup
  const d = await addNode(a, g.id, 'Design', {
    relations: [{ kind: 'part-of', target: p }],
  }) // setup
  const w = await addNode(a, g.id, 'Build', {
    relations: [
      { kind: 'part-of', target: p },
      { kind: 'depends-on', target: d },
    ],
  }) // setup
  const s = await addNode(a, g.id, 'Ship', {
    relations: [{ kind: 'part-of', target: p }],
  }) // setup
  await addNode(a, g.id, 'Announce', {
    relations: [{ kind: 'depends-on', target: w }],
  }) // setup
  const g2 = await createGraph(a, `Second ${tag}`) // setup
  await addNode(a, g2.id, 'Only node') // setup
  const writer = await addAgent(a, {
    name: `Builder ${tag}`,
    permission: 'write',
  }) // setup
  const boss = await addAgent(a, {
    name: `Overseer ${tag}`,
    permission: 'manage',
  }) // setup

  const names = {
    plain: `Panel plain ${tag}`,
    worker: `Panel worker ${tag}`,
    other: `Panel other ${tag}`,
    manager: `Panel manager ${tag}`,
    two: `Panel two ${tag}`,
  }
  await agentSession(a, names.plain) // setup
  const workerId = await agentSession(a, names.worker, {
    agentId: writer.id,
    permission: 'write',
    serves: [`${g.id}#${w}`],
  }) // setup
  const otherId = await agentSession(a, names.other, {
    agentId: writer.id,
    serves: [`${g.id}#${w}`],
  }) // setup
  await agentSession(a, names.manager, {
    agentId: boss.id,
    serves: [g.id],
  }) // setup
  await agentSession(a, names.two, { serves: [`${g.id}#${w}`, g2.id] }) // setup
  // An open request and an unseen change for the manager view, made as the
  // other session over the socket (the tools are test 4's subject).
  await mcp(a, otherId, 'send_request', {
    graphId: g.id,
    nodeId: s,
    kind: 'accept-done',
    title: 'Ship is ready',
  }) // setup
  await mcp(a, otherId, 'update_node', {
    graphId: g.id,
    nodeId: s,
    description: 'Release notes written',
    why: 'E2E why: notes',
  }) // setup

  await openWithSidebar(page)

  // No agent, no serves: no toggle, no panel.
  await goToSession(page, names.plain)
  await expect(panelToggle(page)).toHaveCount(0)
  await expect(graphPanel(page)).toHaveCount(0)

  // Worker: its node, before and after, siblings, other sessions.
  await goToSession(page, names.worker)
  const panel = await showGraphPanel(page)
  await expect(panelToggle(page)).toHaveAttribute('aria-pressed', 'true')
  await expect(panel).toContainText('This session serves a node in')
  const card = panel.getByTestId('session-graph-node-card')
  await expect(card).toContainText('Build')
  await expect(card).toContainText('proposed')
  await expect(card).toContainText('blocked')
  await expect(
    panel.locator('li').filter({ hasText: 'depends on' })
  ).toContainText('Design')
  await expect(
    panel.locator('li').filter({ hasText: 'needed by' })
  ).toContainText('Announce')
  await expect(panel).toContainText('Part of: Phase')
  const siblings = panel.getByTestId('graph-siblings')
  await expect(siblings.locator('li')).toHaveCount(3)
  await expect(
    siblings.locator('li').filter({ hasText: 'Build' })
  ).toContainText('this session')
  await expect(
    siblings.locator('li').filter({ hasText: 'Ship' })
  ).not.toContainText('this session')
  const others = panel
    .locator('section')
    .filter({ hasText: 'Other sessions on this node' })
  await expect(others).toContainText(names.other)
  await expect(others).not.toContainText(names.worker)
  await expect(others.getByTestId('agent-badge')).toContainText(writer.name)
  await shot(page, 'worker-panel')

  // Permission select writes the session metadata.
  await expect(panel.getByLabel('Graph permission')).toHaveValue('write')
  await panel.getByLabel('Graph permission').selectOption('read')
  await expect.poll(() => meta(a, workerId).graph_permission).toBe('read')
  await expect(panel).toContainText(
    'Read graphs; set serves on its own session.'
  )

  // Serves: add a second node, switch to it, remove it.
  const servesSection = panel.locator('section').filter({ hasText: /^Serves/ })
  await servesSection.getByRole('button', { name: 'Add' }).click()
  await servesSection.getByLabel('Serves graph').selectOption(g.id)
  await servesSection.getByLabel('Serves node').selectOption(s)
  await servesSection.getByRole('button', { name: 'Add', exact: true }).click()
  await expect
    .poll(() => meta(a, workerId).serves)
    .toEqual([`${g.id}#${w}`, `${g.id}#${s}`])
  const refPicker = panel.getByLabel('Graph or node')
  await expect(refPicker).toBeVisible()
  await refPicker.selectOption(`${g.id}#${s}`)
  await expect(card).toContainText('Ship')
  await servesSection
    .getByRole('button', { name: `Stop serving ${g.title} › ${s}` })
    .click()
  await expect.poll(() => meta(a, workerId).serves).toEqual([`${g.id}#${w}`])
  await expect(refPicker).toHaveCount(0)
  await expect(card).toContainText('Build')

  // Manager (whole graph): open requests, unseen changes, outline. The
  // panel stays open across the session switch (one toggle for all).
  await goToSession(page, names.manager)
  await expect(graphPanel(page)).toBeVisible()
  await expect(graphPanel(page)).toContainText('serves the whole graph in')
  await expect(graphPanel(page).getByTestId('panel-requests')).toContainText(
    'Ship is ready'
  )
  await expect(graphPanel(page)).toContainText('Open requests (1)')
  await expect(graphPanel(page).getByTestId('panel-changes')).toContainText(
    'Ship:'
  )
  await expect(graphPanel(page)).toContainText(
    'Changes the user has not seen (1)'
  )
  const outline = graphPanel(page)
    .locator('section')
    .filter({ hasText: /^Outline/ })
  for (const title of ['Phase', 'Design', 'Build', 'Ship', 'Announce']) {
    await expect(outline).toContainText(title)
  }
  await expect(graphPanel(page).getByLabel('Graph permission')).toHaveValue(
    'manage'
  )
  await shot(page, 'manager-panel')

  // Two graphs: the picker switches between them.
  await goToSession(page, names.two)
  const two = graphPanel(page)
  await expect(two.getByLabel('Graph or node')).toHaveValue(`${g.id}#${w}`)
  await expect(two.getByTestId('session-graph-node-card')).toContainText(
    'Build'
  )
  await two.getByLabel('Graph or node').selectOption(g2.id)
  await expect(two).toContainText(`serves the whole graph in`)
  await expect(
    two.getByRole('button', { name: g2.title, exact: true })
  ).toBeVisible()
  await expect(two).toContainText('Only node')
  // No agent: read.
  await expect(two.getByLabel('Graph permission')).toHaveValue('read')

  // A plain session hides it; the worker shows it again.
  await goToSession(page, names.plain)
  await expect(graphPanel(page)).toHaveCount(0)
  await goToSession(page, names.worker)
  await expect(graphPanel(page)).toBeVisible()
  // Closed stays closed on the next session.
  await graphPanel(page)
    .getByRole('button', { name: 'Close graph panel' })
    .click()
  await expect(graphPanel(page)).toHaveCount(0)
  await goToSession(page, names.manager)
  await expect(graphPanel(page)).toHaveCount(0)
  await expect(panelToggle(page)).toHaveAttribute('aria-pressed', 'false')

  // "Open in graph" opens the graph with the node's detail.
  await goToSession(page, names.worker)
  await showGraphPanel(page)
  await graphPanel(page).getByRole('button', { name: 'Open in graph' }).click()
  await expect(page.getByTestId('graph-title')).toHaveText(g.title)
  await expect(
    page.getByTestId('graph-node-detail').getByLabel('Node title')
  ).toHaveValue('Build')
})

// ===========================================================================
// 9. Agent badges and the header chip
// ===========================================================================

test('agent badges: glyph vs renamed badge in sidebar, header chip, node detail, review; deleted agent', async ({
  page,
}) => {
  const { a } = readEnv()
  const tag = uid()
  const g = await createGraph(a, `Badges ${tag}`) // setup
  const n = await addNode(a, g.id, 'Badged node') // setup
  const agent = await addAgent(a, {
    name: `Badger ${tag}`,
    permission: 'write',
    color: '#22c55e',
  }) // setup
  // Both start with the agent's name, as the start dialog names them.
  const glyphId = await agentSession(a, agent.name, {
    agentId: agent.id,
    permission: 'write',
    serves: [`${g.id}#${n}`],
  }) // setup
  const renamedId = await agentSession(a, agent.name, {
    agentId: agent.id,
    permission: 'write',
    serves: [`${g.id}#${n}`],
  }) // setup
  const renamed = `Renamed badger ${tag}`
  // A change as the unrenamed session (the tools are test 4's subject).
  await mcp(a, glyphId, 'update_node', {
    graphId: g.id,
    nodeId: n,
    description: 'by the glyph session',
    why: 'E2E why: glyph',
  }) // setup

  await openWithSidebar(page)
  await openGraph(page, g)
  // Reveal both rows in the sidebar tree: open a session of the worktree.
  let detail = await openNode(page, n, 'Badged node')
  await detail
    .getByRole('button', { name: new RegExp(escapeRe(agent.name)) })
    .first()
    .click()
  const glyphRow = sidebarSession(page, glyphId)
  const renamedRow = sidebarSession(page, renamedId)
  await expect(glyphRow).toBeVisible()
  await expect(glyphRow.getByTestId('agent-glyph')).toBeVisible()
  await expect(glyphRow.getByTestId('agent-badge')).toHaveCount(0)
  await expect(renamedRow.getByTestId('agent-glyph')).toBeVisible()

  // Rename through the sidebar's context menu.
  await renamedRow.click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  const input = page.locator(
    `[data-sidebar-row-id="session:${renamedId}"] input`
  )
  await expect(input).toBeVisible()
  await input.fill(renamed)
  await input.press('Enter')
  await expect.poll(() => meta(a, renamedId).name).toBe(renamed)
  await expect(renamedRow.getByTestId('agent-badge')).toHaveText(agent.name)
  await expect(renamedRow.getByTestId('agent-glyph')).toHaveCount(0)

  // The Recent tab rows carry the same marks.
  await page.getByRole('tab', { name: 'Recent' }).click()
  const recent = page.locator('#sidebar-panel-recent')
  await expect(
    recent
      .getByRole('button')
      .filter({ hasText: renamed })
      .getByTestId('agent-badge')
  ).toHaveText(agent.name)
  await expect(
    recent
      .getByRole('button')
      .filter({ hasText: agent.name })
      .filter({ has: page.getByTestId('agent-glyph') })
  ).toHaveCount(1)
  await page.getByRole('tab', { name: 'Projects' }).click()

  // Header chip: "Name · level"; it opens Settings → Agents on the agent.
  await goToSession(page, renamed)
  const chip = page.getByTestId('session-agent-chip')
  await expect(chip).toHaveText(`${agent.name}· write`)
  // A change as the renamed session.
  await runCalls(page, a, renamedId, [
    {
      tool: 'update_node',
      args: {
        graphId: g.id,
        nodeId: n,
        title: 'Badged node 2',
        why: 'E2E why: renamed',
      },
      expect: 'ok',
    },
  ])
  await chip.click()
  await expect(agentsPane(page)).toBeVisible()
  await expect(agentsPane(page).getByLabel('Name')).toHaveValue(agent.name)
  await closeSettings(page)

  // Node detail: serving sessions with glyph and badge.
  await openGraph(page, g)
  detail = await openNode(page, n, 'Badged node 2')
  const serving = detail
    .locator('section')
    .filter({ hasText: 'Serving sessions' })
  const servingRow = (name: string) =>
    serving.getByRole('button').filter({ hasText: name })
  await expect(servingRow(renamed).getByTestId('agent-badge')).toHaveText(
    agent.name
  )
  await expect(
    serving.getByRole('button').filter({ has: page.getByTestId('agent-glyph') })
  ).toHaveCount(1)

  // Review actors.
  await detail.getByRole('button', { name: 'Close node detail' }).click()
  await page.getByTestId('graph-tab-review').click()
  const change = (why: string) =>
    page.getByTestId('graph-change').filter({ hasText: why })
  await expect(
    change('E2E why: glyph').getByTestId('agent-glyph')
  ).toBeVisible()
  await expect(change('E2E why: glyph')).toContainText('write')
  await expect(
    change('E2E why: renamed').getByTestId('agent-badge')
  ).toHaveText(agent.name)
  await shot(page, 'badges')

  // Delete the agent: every badge, the chip and the level go; nothing breaks.
  await runCommand(page, 'Edit Agents…')
  await profileButton(page, agent.name).click()
  await agentsPane(page).getByRole('button', { name: 'Delete' }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete', exact: true })
    .click()
  await expect(profileButton(page, agent.name)).toHaveCount(0)
  await closeSettings(page)
  await expect(change('E2E why: renamed')).toBeVisible()
  await expect(
    page.getByTestId('graph-review').getByTestId('agent-badge')
  ).toHaveCount(0)
  await expect(
    page.getByTestId('graph-review').getByTestId('agent-glyph')
  ).toHaveCount(0)
  await expect(renamedRow).toBeVisible()
  await expect(renamedRow.getByTestId('agent-badge')).toHaveCount(0)
  await expect(glyphRow.getByTestId('agent-glyph')).toHaveCount(0)
  await goToSession(page, renamed)
  await expect(page.getByTestId('session-agent-chip')).toHaveCount(0)
  // The session still has its agent id and serves: the panel stays, at the
  // level the session was started with.
  const panel = await showGraphPanel(page)
  await expect(panel.getByLabel('Graph permission')).toHaveValue('write')
  await expect(panel.getByTestId('agent-badge')).toHaveCount(0)
})

// ===========================================================================
// 10. Fork keeps agent, serves and permission
// ===========================================================================

test('fork of an agent session keeps agent, serves and permission', async ({
  page,
}) => {
  const { a } = readEnv()
  const tag = uid()
  const g = await createGraph(a, `Fork ${tag}`) // setup
  const n = await addNode(a, g.id, 'Forked work') // setup
  const agent = await addAgent(a, {
    name: `Forker ${tag}`,
    permission: 'manage',
  }) // setup
  const name = `Fork source ${tag}`
  const sourceId = await agentSession(a, name, {
    agentId: agent.id,
    permission: 'write',
    serves: [`${g.id}#${n}`],
  }) // setup

  await openWithSidebar(page)
  await goToSession(page, name)
  await send(page, 'Something to fork')
  await waitForIdle(a, sourceId)
  await openSessionMenu(page, name)
  await page
    .getByRole('menuitem', { name: 'Fork Session (same Worktree)' })
    .click()
  let fork: Meta | undefined
  await expect
    .poll(() => {
      fork = allMeta(a).find(m => m.forked_from_session_id === sourceId)
      return !!fork
    })
    .toBe(true)
  expect(fork).toMatchObject({
    agent_id: agent.id,
    graph_permission: 'write',
    serves: [`${g.id}#${n}`],
  })
  // The fork opens with its chip and panel.
  await expect(page.getByTestId('session-agent-chip')).toHaveText(
    `${agent.name}· write`
  )
  const panel = await showGraphPanel(page)
  await expect(panel.getByTestId('session-graph-node-card')).toContainText(
    'Forked work'
  )
})

// ===========================================================================
// 11. Follow-up tools: create_graph, list_requests, list_changes
// ===========================================================================

test('MCP follow-up tools: create_graph in a project, refused for read; list_requests and list_changes see the user', async ({
  page,
}) => {
  const { a, alphaA } = readEnv()
  const tag = uid()
  const g = await createGraph(a, `Follow-up ${tag}`) // setup
  const asked = await addNode(a, g.id, 'Asked node') // setup
  const edited = await addNode(a, g.id, 'Edited node') // setup
  const lead = await addAgent(a, { name: `Lead ${tag}`, permission: 'manage' }) // setup
  const reader = await addAgent(a, {
    name: `Reader ${tag}`,
    permission: 'read',
  }) // setup
  const writer = await addAgent(a, {
    name: `Asker ${tag}`,
    permission: 'write',
  }) // setup
  const leadName = `Lead session ${tag}`
  const leadId = await agentSession(a, leadName, { agentId: lead.id }) // setup
  const readerName = `Reader session ${tag}`
  const readerId = await agentSession(a, readerName, { agentId: reader.id }) // setup
  const askerName = `Asker session ${tag}`
  const askerId = await agentSession(a, askerName, { agentId: writer.id }) // setup

  await openWithSidebar(page)

  // A manage session creates a graph inside the alpha repo (default path).
  const title = `Agent plan ${tag}`
  await goToSession(page, leadName)
  const [created] = await runCalls(page, a, leadId, [
    {
      tool: 'create_graph',
      args: {
        title,
        graphType: 'plan',
        projectId: alphaA.projectId,
        why: 'E2E why: a plan',
      },
      expect: 'ok',
    },
  ])
  const made = JSON.parse(created!.text) as {
    id: string
    path: string
    locationKind: string
  }
  registered.push(made.id)
  const alpha = join(a.repos, 'alpha')
  expect(made.path).toBe(join(alpha, `.splitkick/graphs/agent-plan-${tag}.yml`))
  expect(made.locationKind).toBe('project-repo')
  expect(existsSync(made.path)).toBe(true)
  await expect(graphRow(page, made.id)).toContainText(title)
  await openGraph(page, { id: made.id, title, path: made.path })
  const log = await changes(a, made.id)
  expect(log).toHaveLength(1)
  expect(log[0]).toMatchObject({
    action: 'graph.create',
    why: 'E2E why: a plan',
    actor: { kind: 'session', sessionId: leadId },
  })

  // A read session is refused and writes nothing.
  const refusedPath = join(a.root, `ga-${tag}-refused`, 'graph.yml')
  await goToSession(page, readerName)
  await runCalls(page, a, readerId, [
    {
      tool: 'create_graph',
      args: {
        title: `Refused ${tag}`,
        graphType: 'plan',
        path: refusedPath,
        why: 'E2E why: refused',
      },
      expect:
        "create_graph needs graph permission 'manage', but this session has 'read'",
    },
  ])
  expect(existsSync(refusedPath)).toBe(false)

  // A write session asks a decision and changes another node.
  await goToSession(page, askerName)
  await runCalls(page, a, askerId, [
    {
      tool: 'send_request',
      args: {
        graphId: g.id,
        nodeId: asked,
        kind: 'decision',
        title: 'Which colour?',
        options: ['Red', 'Blue'],
      },
      expect: 'ok',
    },
    {
      tool: 'update_node',
      args: {
        graphId: g.id,
        nodeId: edited,
        title: 'Edited by agent',
        why: 'E2E why: rename',
      },
      expect: 'ok',
    },
  ])

  // The user answers the decision and reverts the rename in Review.
  await openGraph(page, g)
  await page.getByTestId('graph-tab-review').click()
  const review = page.getByTestId('graph-review')
  await review
    .getByTestId('graph-request')
    .filter({ hasText: 'Which colour?' })
    .getByRole('button', { name: 'Blue' })
    .click()
  await expect(
    review.getByTestId('graph-request').filter({ hasText: 'Which colour?' })
  ).toHaveCount(0)
  const rename = review
    .getByTestId('graph-change')
    .filter({ hasText: 'E2E why: rename' })
  await rename.getByRole('button', { name: 'Revert' }).click()
  await expect(rename.getByRole('button', { name: 'reverted' })).toBeDisabled()
  await expectNode(g.path, edited, n => n?.title === 'Edited node')
  const seenBefore = (await changes(a, g.id)).map(c => [c.id, c.seen])

  // The asking session sees the answer and the revert.
  await goToSession(page, askerName)
  const [requests, log2] = await runCalls(page, a, askerId, [
    {
      tool: 'list_requests',
      args: { graphId: g.id, mine: true, status: 'answered' },
      expect: 'ok',
    },
    {
      tool: 'list_changes',
      args: { graphId: g.id, nodeId: edited },
      expect: 'ok',
    },
  ])
  const answered = JSON.parse(requests!.text).requests as Record<
    string,
    unknown
  >[]
  expect(answered).toHaveLength(1)
  expect(answered[0]).toMatchObject({
    nodeRef: `${g.id}#${asked}`,
    nodeTitle: 'Asked node',
    kind: 'decision',
    title: 'Which colour?',
    status: 'answered',
    answer: 'Blue',
    from: askerName,
  })
  const nodeLog = JSON.parse(log2!.text).changes as Record<string, unknown>[]
  const agentRename = nodeLog.find(c => c.why === 'E2E why: rename')
  expect(agentRename).toMatchObject({
    nodeRef: `${g.id}#${edited}`,
    actor: askerName,
    agentId: writer.id,
    action: 'node.update',
    revertedByUser: true,
  })
  expect(agentRename).not.toHaveProperty('before')
  expect(nodeLog[0]).toMatchObject({
    id: agentRename!.revertedBy,
    actor: 'you',
    action: 'revert',
  })
  // Reading the log does not mark anything as seen.
  expect((await changes(a, g.id)).map(c => [c.id, c.seen])).toEqual(
    seenBefore
  )
  await shot(page, 'follow-up-tools')
  rmSync(made.path, { force: true }) // cleanup: the fixture repo is shared
})
