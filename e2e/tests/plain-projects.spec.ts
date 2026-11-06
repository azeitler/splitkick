import type { Locator, Page } from '@playwright/test'
import { test, expect, sidebar, MOD } from '../fixtures/tauri-mock'
import { createProject, createWorktree } from '../fixtures/mock-data'

/**
 * Plain projects (#93): a folder without git is added as a plain project or
 * initialized as git; a plain project shows no git features.
 *
 * PLAIN_PROJECTS_SCREENSHOT_DIR=<dir> saves the screenshots for the docs.
 */

const shotDir = process.env.PLAIN_PROJECTS_SCREENSHOT_DIR
const now = new Date()
const pad = (n: number) => String(n).padStart(2, '0')
// Local time, like the Showing Work rules ask.
const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`

/** Saves a screenshot of the page, or of one element, when asked for. */
async function shot(target: Page | Locator, name: string) {
  if (!shotDir) return
  await target.screenshot({ path: `${shotDir}/${name}-${stamp}.png` })
}

const app = createProject({ name: 'website', path: '/Volumes/Work/website' })
const paperwork = createProject({
  name: 'Paperwork',
  path: '/Volumes/Work/Paperwork',
  default_branch: '',
  is_git: false,
  order: 1,
})
const appMain = createWorktree(app.id, {
  name: 'main',
  branch: 'main',
  path: app.path,
  session_type: 'base',
})
const appFeature = createWorktree(app.id, {
  name: 'pricing-table',
  branch: 'pricing-table',
  order: 1,
})
const paperworkBase = createWorktree(paperwork.id, {
  name: 'Paperwork',
  branch: '',
  path: paperwork.path,
  session_type: 'base',
})

const NEW_FOLDER = '/Volumes/Work/Dropbox/Client Files'

test.use({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  responseOverrides: {
    list_projects: [app, paperwork],
    // Without it the sidebar's graph section crashes on a null list.
    list_graphs: [],
    list_worktrees: [appMain, appFeature, paperworkBase],
    browse_directory: {
      current_path: NEW_FOLDER,
      parent_path: '/Volumes/Work/Dropbox',
      entries: [],
    },
    check_git_identity: { name: 'Demo User', email: 'demo@example.com' },
    inspect_git_init_folder: {
      file_count: 248,
      total_bytes: 734 * 1024 * 1024,
      truncated: false,
      has_gitignore: false,
      sync_provider: 'Dropbox',
    },
  },
})

test.describe('Plain projects (#93)', () => {
  // The first canvas render compiles a large lazy chunk in the dev server.
  test.setTimeout(120_000)

  test('a plain project hides git features; a git project keeps them', async ({
    mockPage,
  }) => {
    await mockPage.getByText('Paperwork', { exact: true }).first().click()
    await expect(mockPage.getByText('Loading Splitkick...')).toHaveCount(0, {
      timeout: 90_000,
    })
    await mockPage.getByRole('button', { name: 'Show sidebar' }).click()
    await expect(mockPage.getByTestId('sidebar-home-row')).toBeVisible({
      timeout: 30_000,
    })
    const panel = sidebar(mockPage)
    await expect(
      panel.getByText('Paperwork', { exact: true }).first()
    ).toBeVisible()

    const plainRow = panel.getByTestId(`project-row-${paperwork.id}`)
    const gitRow = panel.getByTestId(`project-row-${app.id}`)
    await expect(
      gitRow.getByRole('button', { name: 'New worktree' })
    ).toHaveCount(1)
    await expect(
      plainRow.getByRole('button', { name: 'New worktree' })
    ).toHaveCount(0)

    // ⌘K: no GitHub commands for the plain project.
    await mockPage.keyboard.press(`${MOD}+k`)
    const palette = mockPage.getByRole('dialog')
    await expect(palette).toBeVisible()
    await mockPage.keyboard.type('GitHub')
    await expect(palette.getByText('GitHub Dashboard')).toBeVisible()
    await expect(palette.getByText('Open GitHub Issues')).toHaveCount(0)
    await mockPage.keyboard.press('Escape')
    await expect(palette).toHaveCount(0)

    await shot(mockPage, 'plain-project-sidebar')
  })

  test('adding a folder without git offers both choices', async ({
    mockPage,
  }) => {
    await mockPage.evaluate(
      ({ plainId }) => {
        const mock = (
          window as unknown as {
            __JEAN_E2E_MOCK__: {
              invokeHandlers: Record<
                string,
                (args?: Record<string, unknown>) => unknown
              >
            }
          }
        ).__JEAN_E2E_MOCK__
        mock.invokeHandlers.add_project = args => {
          if (!args?.plain) {
            throw 'The selected folder is not a git repository.'
          }
          return {
            id: plainId,
            name: 'Client Files',
            path: args.path,
            default_branch: '',
            added_at: 0,
            order: 2,
            is_git: false,
          }
        }
      },
      { plainId: 'plain-new' }
    )

    await mockPage.getByRole('button', { name: 'Add Project' }).click()
    await mockPage.getByText('Add Existing Project').click()
    await mockPage
      .getByRole('button', { name: 'Select current folder' })
      .click()

    const modal = mockPage.getByRole('dialog', {
      name: 'This folder has no git',
    })
    await expect(modal).toBeVisible()
    await expect(
      modal.getByRole('radio', { name: /Add without git/ })
    ).toHaveAttribute('aria-checked', 'true')
    await expect(
      modal.getByRole('radio', { name: /Initialize Git/ })
    ).toBeVisible()
    await expect(modal.getByRole('alert')).toContainText(
      'This folder is in Dropbox'
    )
    await shot(modal, 'plain-project-add-choices')

    await modal.getByRole('radio', { name: /Initialize Git/ }).click()
    await expect(modal.getByText(/for OS junk and temp files/)).toBeVisible()
    await expect(modal.getByTestId('git-init-file-summary')).toHaveText(
      '248 files (734 MB)'
    )
    await shot(modal, 'plain-project-init-git')
  })
})
