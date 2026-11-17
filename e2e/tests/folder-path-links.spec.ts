import { test, expect, activateWorktree } from '../fixtures/tauri-mock'
import {
  createProject,
  createSession,
  createWorktree,
  mockPreferences,
  mockUIState,
} from '../fixtures/mock-data'

/**
 * Paths in an agent reply: a folder in inline code or a markdown link opens
 * in the file manager, a file opens in the file viewer, and a path-like token
 * that does not exist stays plain code.
 */

const WORKTREE = '/tmp/e2e-folder-links/.worktrees/release-notes'
const HOME = '/Users/me'
const FOLDERS = [
  `${HOME}/Projects/jean/docs/release-notes`,
  `${WORKTREE}/docs/developer`,
]
const FILES = [`${WORKTREE}/src/lib/chat-links.ts`]

const REPLY = [
  'Done. I wrote the notes to `~/Projects/jean/docs/release-notes` and changed `src/lib/chat-links.ts`.',
  '',
  'The ratio stays `1/2`, and `a/b` does not exist. The patterns are in [the developer docs](docs/developer/).',
].join('\n')

const project = createProject({ name: 'Splitkick' })
const session = createSession({ name: 'Release notes', order: 0 })
const now = Math.floor(Date.now() / 1000)
session.messages = [
  {
    id: `${session.id}-m0`,
    session_id: session.id,
    role: 'user',
    content: 'Where did you put the release notes?',
    timestamp: now - 120,
    tool_calls: [],
  },
  {
    id: `${session.id}-m1`,
    session_id: session.id,
    role: 'assistant',
    content: REPLY,
    content_blocks: [{ type: 'text', text: REPLY }],
    timestamp: now - 60,
    tool_calls: [],
  },
]
const worktree = createWorktree(project.id, {
  name: 'release-notes',
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

test('folder paths in a reply open in the file manager', async ({
  mockPage: page,
}) => {
  await page.evaluate(
    async ({ folders, files, home }) => {
      // Web Access on localhost, where the host may open Finder.
      const env = await import('/src/lib/environment.ts')
      env.setNativeOpenAllowed(true)
      // The backend host is a Mac, so the file manager is Finder.
      const platform = await import('/src/lib/platform.ts')
      platform.setServerPlatform('mac')
      const mock = (window as any).__JEAN_E2E_MOCK__
      const opened: string[] = []
      ;(window as any).__openedPaths = opened
      mock.invokeHandlers.resolve_file_reference = (args: {
        candidates: string[]
      }) => {
        const found = args.candidates
          .map(c => c.replace(/^~/, home).replace(/\/$/, ''))
          .filter(c => folders.includes(c) || files.includes(c))
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
    { folders: FOLDERS, files: FILES, home: HOME }
  )

  await activateWorktree(page, 'release-notes')
  const modal = page.getByTestId('session-chat-modal-swipe')

  const folder = modal.getByRole('link', {
    name: '~/Projects/jean/docs/release-notes',
  })
  await expect(folder).toHaveAttribute('data-folder', '')
  await expect(
    modal.getByRole('link', { name: 'src/lib/chat-links.ts' })
  ).not.toHaveAttribute('data-folder')
  await expect(
    modal.getByRole('link', { name: 'the developer docs' })
  ).toHaveAttribute('data-folder', '')
  // Path-like but missing, and not path-like at all: plain code.
  await expect(modal.getByRole('link', { name: 'a/b' })).toHaveCount(0)
  await expect(modal.getByRole('link', { name: '1/2' })).toHaveCount(0)

  await folder.hover()
  await expect(page.getByRole('tooltip')).toHaveText('Open in Finder')
  if (shotDir) {
    await page.screenshot({
      path: `${shotDir}/folder-link-reply-${stamp}.png`,
    })
  }

  await folder.click()
  await expect
    .poll(() => page.evaluate(() => (window as any).__openedPaths))
    .toEqual([FOLDERS[0]])

  // Away from the link first, so its tooltip is gone.
  await page.mouse.move(900, 500)
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await folder.click({ button: 'right' })
  await expect(
    page.getByRole('menuitem', { name: 'Open in Finder' })
  ).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Copy path' })).toBeVisible()
  if (shotDir) {
    // Let the menu finish its fade-in.
    await page.waitForTimeout(400)
    await page.screenshot({
      path: `${shotDir}/folder-link-menu-${stamp}.png`,
    })
  }
})
