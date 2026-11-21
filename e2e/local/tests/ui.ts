/** Page helpers for the local two-instance e2e run (#65). */
import { expect, type Locator, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { RUN_DIR } from '../helpers'
import type { Instance } from '../launcher'

/** Unique session name: scenarios can run again against kept instances. */
export function uniqueName(base: string): string {
  return `${base} ${Date.now().toString(36)}`
}

export interface Connection {
  id: string
  name: string
  url: string
  token: string
}

/** Open an instance's web UI. `connections` are saved remote connections. */
export async function openApp(
  page: Page,
  instance: Instance,
  connections: Connection[] = []
): Promise<void> {
  if (connections.length > 0) {
    await page.addInitScript(list => {
      localStorage.setItem('jean-remote-connections', JSON.stringify(list))
    }, connections)
  }
  await page.goto(`${instance.url}/?token=${instance.token}`)
  await expect(page.getByText('Go to…').first()).toBeVisible()
}

/** Select a sidebar tab (Projects, Recent, Starred, To-Do, Graphs). "Go
 *  to…" switches back to Projects, so call this before using another tab. */
export async function showSidebarTab(
  page: Page,
  tab: 'projects' | 'recent' | 'starred' | 'todo' | 'graphs'
): Promise<void> {
  const button = page.getByTestId(`sidebar-tab-${tab}`)
  await button.click()
  await expect(button).toHaveAttribute('aria-selected', 'true')
}

/** Open a session by name through the "Go to…" search. */
export async function goToSession(page: Page, name: string): Promise<void> {
  await page.getByText('Go to…').first().click()
  await page.keyboard.type(name)
  const noResults = page.getByText('No results found.')
  const option = page.getByRole('option', { name: new RegExp(name) }).first()
  await expect(option.or(noResults)).toBeVisible()
  // "Go to…" leaves out the session that is already open.
  await page.keyboard.press((await noResults.isVisible()) ? 'Escape' : 'Enter')
  await expect(sessionTab(page, name)).toBeVisible()
}

export function sessionTab(page: Page, name: string) {
  // Visible only: the sidebar tree keeps its rows, hidden, under other tabs.
  return page.getByText(name, { exact: true }).filter({ visible: true }).first()
}

export function chatInput(page: Page) {
  return page.locator('textarea[data-slot="textarea"]').last()
}

/** Send a message and wait for the stub's answer to it. */
export async function send(page: Page, text: string): Promise<string> {
  // A paragraph: a reply after tool calls also shows in the step summary.
  const replies = page.locator('p', { hasText: /^STUB REPLY/ })
  const before = await replies.count()
  await chatInput(page).fill(text)
  await page.keyboard.press('Enter')
  await expect(replies).toHaveCount(before + 1, { timeout: 60_000 })
  return replies.last().innerText()
}

/** Named, timestamped screenshot in the run's artefact folder. */
export async function shot(page: Page, name: string): Promise<void> {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  const dir = join(RUN_DIR, 'screens')
  mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: join(dir, `${name}-${stamp}.png`) })
}

/** Open a session's context menu (from the open chat modal or its tab). */
export async function openSessionMenu(page: Page, name: string): Promise<void> {
  // The chat modal, when open, covers the tabs and renders the name last.
  await page.getByText(name, { exact: true }).last().click({ button: 'right' })
  await expect(page.getByRole('menu')).toBeVisible()
}

/** Run a command palette entry by its label. */
export async function runCommand(page: Page, label: string): Promise<void> {
  await page.keyboard.press('Meta+k')
  const input = page.getByRole('dialog').getByRole('combobox')
  await expect(input).toBeFocused()
  await input.fill(label)
  await page
    .getByRole('option', { name: new RegExp(`^${label}`) })
    .first()
    .click()
}

// ---------------------------------------------------------------------------
// Graph panels (node detail, session graph panel)
// ---------------------------------------------------------------------------

/** How the graph UI names the stored node states (`STATE_LABELS` in
 *  src/components/graphs/graph-badges.tsx). The file word is the key. */
export const NODE_STATE_LABELS = {
  proposed: 'Idea',
  committed: 'Planned',
  done: 'Done',
  dropped: 'Dropped',
} as const
export type NodeState = keyof typeof NODE_STATE_LABELS

/** A state chip shows the label; its tooltip has the stored state. */
export async function expectStateChip(
  chip: Locator,
  state: NodeState
): Promise<void> {
  await expect(chip).toHaveAttribute('title', `state: ${state}`)
}

/** The state picker button of an open node detail. */
export function stateButton(detail: Locator, state: NodeState): Locator {
  return detail.getByRole('radio', {
    name: NODE_STATE_LABELS[state],
    exact: true,
  })
}

/** The state glyph (an outline row's leading mark) for this state. */
export function stateGlyph(scope: Locator, state: NodeState): Locator {
  return scope.locator(`svg[aria-label="${NODE_STATE_LABELS[state]}"]`)
}

type GraphFoldout = 'relations' | 'details'

/**
 * Open the foldouts of a graph panel the way a user does: "Relationships"
 * (relations, incoming, siblings) and "Show details" (id, properties,
 * attachments, history, delete; permission and serves in the session
 * panel). Each foldout is one saved choice for every panel, so it can be
 * open already from an earlier test: click only a closed one. A manager
 * session panel has no Relationships foldout; pass `['details']`.
 */
export async function openGraphFoldouts(
  panel: Locator,
  foldouts: GraphFoldout[] = ['relations', 'details']
): Promise<void> {
  for (const foldout of foldouts) {
    const toggle = panel.getByTestId(`graph-${foldout}-toggle`)
    await expect(toggle).toBeVisible()
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
      await toggle.click()
    }
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  }
}

/** Start to edit the description of the open node ("Add description" or
 *  "Edit description") and return the field. It saves on blur. */
export async function editDescription(detail: Locator): Promise<Locator> {
  const field = detail.getByLabel('Description', { exact: true })
  if (!(await field.isVisible())) {
    await detail
      .getByRole('button', { name: /^(Add|Edit) description$/ })
      .click()
  }
  await expect(field).toBeVisible()
  return field
}
