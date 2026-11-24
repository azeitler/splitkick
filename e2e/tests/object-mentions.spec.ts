import type { Page } from '@playwright/test'
import {
  test,
  expect,
  activateWorktree,
  createChatSession,
} from '../fixtures/tauri-mock'
import {
  createProject,
  createSession,
  createWorktree,
  mockUIState,
} from '../fixtures/mock-data'

/**
 * `@` in the composer mentions files and Splitkick objects: sessions,
 * projects, worktrees, agents and remote connections. A mention inserts a
 * markdown link with the object's name and its splitkick:// link.
 */

const now = Math.floor(Date.now() / 1000)
const acme = createProject({ name: 'Acme', path: '/Users/me/acme', order: 0 })
const website = createProject({
  name: 'Website',
  path: '/Users/me/website',
  order: 1,
})

const releaseNotes = createSession({
  name: 'Release notes',
  updated_at: now - 600,
})
const fixLogin = createSession({ name: 'Fix login', updated_at: now - 60 })
const heroImage = createSession({
  name: 'New hero image',
  updated_at: now - 30,
})

const acmeTree = createWorktree(acme.id, {
  name: 'fuzzy-tiger',
  path: '/Users/me/acme/.worktrees/fuzzy-tiger',
  sessions: [releaseNotes, fixLogin],
})
const siteTree = createWorktree(website.id, {
  name: 'calm-dolphin',
  path: '/Users/me/website/.worktrees/calm-dolphin',
  sessions: [heroImage],
})

const releaseManager = {
  id: 'agent-release',
  name: 'Release manager',
  scope: 'global',
  projectId: null,
  projectName: null,
  roleId: null,
  worktreeId: acmeTree.id,
  worktreePath: acmeTree.path,
  sessionId: releaseNotes.id,
  sessionName: releaseNotes.name,
  pastSessionIds: [],
  createdAt: now,
}

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

test.use({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  responseOverrides: {
    list_projects: [acme, website],
    list_worktrees: [acmeTree, siteTree],
    // The composer takes the current project from the worktree.
    get_worktree: acmeTree,
    // With a real worktree the toolbar lists the loaded contexts.
    list_loaded_issue_contexts: [],
    list_loaded_pr_contexts: [],
    list_loaded_security_contexts: [],
    list_loaded_advisory_contexts: [],
    list_loaded_linear_issue_contexts: [],
    get_sentry_issue_context_contents: [],
    list_attached_saved_contexts: [],
    list_saved_contexts: [],
    get_ports: [],
    list_all_sessions: {
      entries: [entry(acme, acmeTree), entry(website, siteTree)],
    },
    list_agents: [releaseManager],
    list_remote_connections: [
      {
        id: 'conn-mac2',
        name: 'Mac 2',
        url: 'https://box.tail1234.ts.net',
        hasToken: true,
      },
    ],
    list_worktree_files: [
      { relative_path: 'README.md', extension: 'md', is_dir: false },
      { relative_path: 'src/release.ts', extension: 'ts', is_dir: false },
    ],
    load_ui_state: {
      ...mockUIState,
      active_project_id: acme.id,
      expanded_project_ids: [acme.id],
    },
  },
})

const shotDir = process.env.OBJECT_MENTIONS_SCREENSHOT_DIR
const shotStamp = process.env.OBJECT_MENTIONS_SCREENSHOT_STAMP ?? 'shot'

async function openComposer(page: Page) {
  await expect(page.getByText('Acme').first()).toBeVisible({ timeout: 5000 })
  await activateWorktree(page, 'fuzzy-tiger')
  await createChatSession(page)
  const textarea = page.locator('textarea').first()
  await expect(textarea).toBeVisible({ timeout: 3000 })
  return textarea
}

test.describe('@ mentions of Splitkick objects', () => {
  test('lists every group and inserts a session and an agent link', async ({
    mockPage,
  }) => {
    const textarea = await openComposer(mockPage)

    await textarea.click()
    await textarea.pressSequentially('Ask @')
    const picker = mockPage.locator('[data-slot="popover-content"]', {
      hasText: 'Mentions',
    })
    await expect(picker).toBeVisible()
    for (const heading of [
      'Files',
      'Sessions',
      'Projects',
      'Worktrees',
      'Agents',
      'Connections',
    ]) {
      await expect(
        picker.locator('[cmdk-group-heading]', { hasText: heading })
      ).toBeVisible()
    }
    await expect(picker.getByText('box.tail1234.ts.net')).toBeVisible()
    // Likely targets first: sessions of this project before the newer one
    // in another project.
    await expect(
      picker
        .locator('[cmdk-item]')
        .filter({ hasText: /Fix login|New hero image/ })
    ).toHaveText([/Fix login/, /New hero image/])
    if (shotDir) {
      await picker.screenshot({
        path: `${shotDir}/object-mentions-${shotStamp}.png`,
      })
    }

    // A name puts its group first; Enter takes the top row.
    await textarea.pressSequentially('releasenot')
    await expect(picker.locator('[cmdk-group-heading]').first()).toHaveText(
      'Sessions'
    )
    await textarea.press('Enter')
    await expect(textarea).toHaveValue(
      `Ask [Release notes](splitkick://session/${releaseNotes.id}) `
    )

    await textarea.pressSequentially('and @manager')
    await expect(picker.locator('[cmdk-group-heading]').first()).toHaveText(
      'Agents'
    )
    await textarea.press('Tab')
    await expect(textarea).toHaveValue(
      `Ask [Release notes](splitkick://session/${releaseNotes.id}) ` +
        'and [Release manager](splitkick://agent/agent-release) '
    )
  })
})
