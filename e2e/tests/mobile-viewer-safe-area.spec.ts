import type { Locator, Page } from '@playwright/test'
import { test, expect } from '../fixtures/tauri-mock'
import {
  createProject,
  createSession,
  createWorktree,
  mockUIState,
} from '../fixtures/mock-data'

/**
 * Full-screen viewers on a phone keep their controls and content out of the
 * notch / Dynamic Island, the home indicator and the landscape side insets.
 * env(safe-area-inset-*) is 0 in a desktop browser, so the test sets the
 * --safe-area-* variables the app reads instead.
 *
 * SAFE_AREA_SHOTS=<label> saves a screenshot of each viewer to tmp/.
 */

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000"><rect width="1600" height="1000" fill="#3b82f6"/><circle cx="800" cy="500" r="300" fill="#f59e0b"/></svg>`
const IMAGE_SRC = `data:image/svg+xml;base64,${Buffer.from(SVG).toString('base64')}`
const FILE_PATH = '/tmp/e2e-safe-area/src/main.ts'
const FILE_CONTENT = Array.from(
  { length: 80 },
  (_, i) =>
    `export const line${i} = ${i} // a long line of code to fill the row`
).join('\n')

const project = createProject({ name: 'Phone Project' })
const now = Math.floor(Date.now() / 1000)
const session = createSession({
  name: 'Viewer session',
  order: 0,
  last_opened_at: now - 30,
})
session.messages = [
  {
    id: `${session.id}-m0`,
    session_id: session.id,
    role: 'user',
    content: 'Draw a chart',
    timestamp: now - 120,
    tool_calls: [],
  },
  {
    id: `${session.id}-m1`,
    session_id: session.id,
    role: 'assistant',
    content: `Here it is:\n\n![Chart](${IMAGE_SRC})`,
    timestamp: now - 60,
    tool_calls: [],
  },
]
const worktree = createWorktree(project.id, {
  name: 'fuzzy-tiger',
  path: '/tmp/e2e-safe-area',
  sessions: [session],
})

const INSETS = {
  portrait: {
    viewport: { width: 390, height: 844 },
    top: 47,
    right: 12,
    bottom: 34,
    left: 12,
  },
  landscape: {
    viewport: { width: 844, height: 390 },
    top: 0,
    right: 47,
    bottom: 21,
    left: 47,
  },
} as const

type Insets = (typeof INSETS)[keyof typeof INSETS]

test.use({
  hasTouch: true,
  responseOverrides: {
    list_projects: [project],
    list_worktrees: [worktree],
    list_all_sessions: {
      entries: [
        {
          project_id: project.id,
          project_name: project.name,
          worktree_id: worktree.id,
          worktree_name: worktree.name,
          worktree_path: worktree.path,
          sessions: [session],
        },
      ],
    },
    load_ui_state: { ...mockUIState, active_project_id: null },
    read_file_content: FILE_CONTENT,
  },
})

async function setInsets(page: Page, insets: Insets) {
  await page.addStyleTag({
    content: `:root {
      --safe-area-top: ${insets.top}px !important;
      --safe-area-right: ${insets.right}px !important;
      --safe-area-bottom: ${insets.bottom}px !important;
      --safe-area-left: ${insets.left}px !important;
    }
    .tsqd-parent-container { display: none !important; }`,
  })
}

/**
 * Every button of the dialog, and the given content, lies inside the viewport
 * minus the insets.
 */
async function expectInsideSafeArea(
  insets: Insets,
  dialog: Locator,
  content: Record<string, Locator>
) {
  const { width, height } = insets.viewport
  const buttons = await dialog.getByRole('button').all()
  expect(buttons.length).toBeGreaterThan(1)
  const locators = {
    ...Object.fromEntries(buttons.map((b, i) => [`button ${i}`, b])),
    ...content,
  }
  for (const [name, locator] of Object.entries(locators)) {
    await expect(locator, name).toBeVisible()
    const box = await locator.boundingBox()
    expect(box, name).not.toBeNull()
    if (!box) continue
    const rounded = {
      left: Math.round(box.x),
      top: Math.round(box.y),
      right: Math.round(box.x + box.width),
      bottom: Math.round(box.y + box.height),
    }
    expect(rounded.left, `${name} left`).toBeGreaterThanOrEqual(insets.left)
    expect(rounded.top, `${name} top`).toBeGreaterThanOrEqual(insets.top)
    expect(rounded.right, `${name} right`).toBeLessThanOrEqual(
      width - insets.right
    )
    expect(rounded.bottom, `${name} bottom`).toBeLessThanOrEqual(
      height - insets.bottom
    )
  }
}

async function shot(page: Page, name: string) {
  const label = process.env.SAFE_AREA_SHOTS
  if (!label) return
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  // Let the dialog's open animation finish.
  await page.waitForTimeout(400)
  await page.screenshot({ path: `tmp/${name}-${label}-${stamp}.png` })
}

for (const [orientation, insets] of Object.entries(INSETS)) {
  test.describe(`viewers in ${orientation}`, () => {
    test.use({ viewport: insets.viewport })

    test('the image viewer stays inside the safe area', async ({
      mockPage: page,
    }) => {
      await setInsets(page, insets)
      if (orientation === 'portrait') {
        await page.getByRole('tab', { name: 'History' }).click()
        await page
          .getByTestId('mobile-history-sessions')
          .getByRole('button')
          .first()
          .click()
      } else {
        await page.getByText('fuzzy-tiger').first().click()
      }
      const chat = page.getByTestId('session-chat-modal-swipe')
      await expect(chat).toBeVisible()
      await chat.getByRole('img', { name: 'Chart' }).click()

      const dialog = page.getByRole('dialog', { name: 'Image Preview' })
      await expect(dialog).toBeVisible()
      await shot(page, `safe-area-image-${orientation}`)
      await expect(dialog.getByRole('button', { name: 'Close' })).toBeVisible()
      await expectInsideSafeArea(insets, dialog, {
        image: dialog.getByRole('img', { name: 'Chart' }),
      })
    })

    test('the file viewer stays inside the safe area', async ({
      mockPage: page,
    }) => {
      await setInsets(page, insets)
      await page.evaluate(async path => {
        const { useUIStore } = await import('/src/store/ui-store.ts')
        useUIStore.getState().setViewingFilePath(path)
      }, FILE_PATH)

      const dialog = page.getByRole('dialog', { name: /main\.ts/ })
      await expect(dialog.getByText('line79 = 79')).toBeAttached()
      await shot(page, `safe-area-file-${orientation}`)
      await expect(dialog.getByRole('button', { name: 'Close' })).toBeVisible()
      await expectInsideSafeArea(insets, dialog, {
        title: dialog.getByText('main.ts', { exact: true }),
        content: dialog.locator('[data-slot="scroll-area"]').first(),
      })
    })
  })
}
