import { test, expect, activateWorktree } from '../fixtures/tauri-mock'
import {
  createProject,
  createSession,
  createWorktree,
  mockPreferences,
  mockUIState,
} from '../fixtures/mock-data'

/**
 * Paths in expanded tool output: `ls` and `grep -n` lines link the paths that
 * exist. A folder opens in the file manager, a grep hit opens the file in the
 * file viewer, and a missing path stays plain text. One `check_paths` call
 * per output, and none while the tool call is collapsed.
 */

const WORKTREE = '/tmp/e2e-tool-output-links/.worktrees/path-links'
const FOLDERS = [`${WORKTREE}/src/lib`, `${WORKTREE}/docs/developer`]
const FILES = [
  `${WORKTREE}/src/lib/chat-links.ts`,
  `${WORKTREE}/src/lib/file-reference.ts`,
]

const COMMAND =
  'ls -d src/lib docs/developer docs/missing && grep -n "toLocalReferencePath" src/lib/*.ts'
const OUTPUT = [
  'src/lib',
  'docs/developer',
  'ls: docs/missing: No such file or directory',
  'src/lib/chat-links.ts:51:export function toLocalReferencePath(ref: string | undefined): string | null {',
  "src/lib/file-reference.ts:27:import { LocalPathRootContext, toLocalReferencePath } from '@/lib/chat-links'",
  'src/lib/old-links.ts:9:// toLocalReferencePath moved',
].join('\n')
const REPLY = 'Both files use `toLocalReferencePath`.'

const project = createProject({ name: 'Splitkick' })
const session = createSession({ name: 'Path links', order: 0 })
const now = Math.floor(Date.now() / 1000)
session.messages = [
  {
    id: `${session.id}-m0`,
    session_id: session.id,
    role: 'user',
    content: 'Where is toLocalReferencePath used?',
    timestamp: now - 120,
    tool_calls: [],
  },
  {
    id: `${session.id}-m1`,
    session_id: session.id,
    role: 'assistant',
    content: REPLY,
    content_blocks: [
      { type: 'tool_use', tool_call_id: 'bash-1' },
      { type: 'text', text: REPLY },
    ],
    timestamp: now - 60,
    tool_calls: [
      {
        id: 'bash-1',
        name: 'Bash',
        input: { command: COMMAND, description: 'Find the callers' },
        output: OUTPUT,
      },
    ],
  },
]
const worktree = createWorktree(project.id, {
  name: 'path-links',
  path: WORKTREE,
  sessions: [session],
})

test.use({
  viewport: { width: 1280, height: 800 },
  responseOverrides: {
    list_projects: [project],
    list_worktrees: [worktree],
    load_preferences: { ...mockPreferences, zoom_level: 100 },
    load_ui_state: {
      ...mockUIState,
      active_project_id: project.id,
      expanded_project_ids: [project.id],
    },
  },
})

const shotDir = process.env.FOLDER_LINKS_SCREENSHOT_DIR
const stamp = process.env.FOLDER_LINKS_SCREENSHOT_STAMP ?? 'local'

test('paths in expanded tool output become links', async ({
  mockPage: page,
}) => {
  await page.evaluate(
    async ({ folders, files }) => {
      const env = await import('/src/lib/environment.ts')
      env.setNativeOpenAllowed(true)
      const platform = await import('/src/lib/platform.ts')
      platform.setServerPlatform('mac')
      const mock = (window as any).__JEAN_E2E_MOCK__
      const opened: string[] = []
      const checks: unknown[] = []
      ;(window as any).__openedPaths = opened
      ;(window as any).__checkCalls = checks
      mock.invokeHandlers.check_paths = (args: {
        paths: string[]
        root: string
      }) => {
        checks.push(args)
        return args.paths.map(path => {
          const full = `${args.root}/${path}`.replace(/\/$/, '')
          const exists = folders.includes(full) || files.includes(full)
          return {
            path,
            exists,
            isDir: folders.includes(full),
            resolvedPath: exists ? full : null,
          }
        })
      }
      mock.invokeHandlers.resolve_file_reference = (args: {
        candidates: string[]
      }) => {
        const found = args.candidates.filter(
          c => folders.includes(c) || files.includes(c)
        )
        return {
          path: found[0] ?? null,
          candidates: found,
          searched: false,
          isDir: folders.includes(found[0] ?? ''),
        }
      }
      mock.invokeHandlers.open_path_in_default_app = (args: {
        path: string
      }) => {
        opened.push(args.path)
        return null
      }
    },
    { folders: FOLDERS, files: FILES }
  )

  await activateWorktree(page, 'path-links')
  const modal = page.getByTestId('session-chat-modal-swipe')
  // The tool call sits in a collapsed step group; open the group only.
  await modal.getByText('1 step').click()
  await expect(modal.getByText('Bash', { exact: true })).toBeVisible()

  // The tool call itself is still collapsed: no check yet.
  expect(await page.evaluate(() => (window as any).__checkCalls.length)).toBe(0)

  await modal.getByText('Bash', { exact: true }).click()
  const output = modal.locator('pre').filter({ hasText: 'docs/missing' })
  await expect(
    output.getByRole('link', { name: 'src/lib', exact: true })
  ).toHaveAttribute('data-folder', '')
  await expect(
    output.getByRole('link', { name: 'src/lib/chat-links.ts:51' })
  ).toBeVisible()
  await expect(
    output.getByRole('link', { name: 'src/lib/file-reference.ts:27' })
  ).toBeVisible()
  await expect(
    output.getByRole('link', { name: /missing|old-links/ })
  ).toHaveCount(0)
  expect(await output.textContent()).toBe(OUTPUT)
  expect(await page.evaluate(() => (window as any).__checkCalls.length)).toBe(1)

  if (shotDir) {
    // Let the step group and the tool call finish expanding.
    await page.waitForTimeout(400)
    await output.getByRole('link', { name: 'src/lib/chat-links.ts:51' }).hover()
    await page.screenshot({ path: `${shotDir}/tool-output-links-${stamp}.png` })
  }

  await output.getByRole('link', { name: 'docs/developer' }).click()
  await expect
    .poll(() => page.evaluate(() => (window as any).__openedPaths))
    .toEqual([FOLDERS[1]])

  await page.mouse.move(900, 500)
  await output
    .getByRole('link', { name: 'src/lib/chat-links.ts:51' })
    .click({ button: 'right' })
  await expect(
    page.getByRole('menuitem', { name: 'Reveal in Finder' })
  ).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Copy path' })).toBeVisible()
  if (shotDir) {
    await page.waitForTimeout(400)
    await page.screenshot({
      path: `${shotDir}/tool-output-links-menu-${stamp}.png`,
    })
  }
  await page.keyboard.press('Escape')

  await output.getByRole('link', { name: 'src/lib/chat-links.ts:51' }).click()
  await expect(
    page.getByText(`${WORKTREE}/src/lib/chat-links.ts`).first()
  ).toBeVisible()
})
