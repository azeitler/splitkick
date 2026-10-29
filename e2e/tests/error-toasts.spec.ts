import { test, expect } from '../fixtures/tauri-mock'
import type { Page } from '@playwright/test'

/**
 * Error toasts stay until closed, and a right-click copies them (#69). The
 * toasts come from the app's own sonner instance: the test imports the same
 * pre-bundled module URL the app loaded, so it shares the app's toast state.
 */
async function showToast(
  page: Page,
  kind: 'error' | 'success' | 'loadingThenError',
  title: string,
  description?: string
) {
  await page.evaluate(
    async ({ kind, title, description }) => {
      const url = performance
        .getEntriesByType('resource')
        .map(entry => entry.name)
        .find(name => /\/deps\/sonner\.js/.test(name))
      if (!url) throw new Error('sonner module not loaded')
      const { toast } = await import(/* @vite-ignore */ url)
      if (kind === 'success') toast.success(title)
      else if (kind === 'error') toast.error(title, { description })
      else {
        const id = toast.loading('Pushing…')
        toast.error(title, { id, description })
      }
    },
    { kind, title, description }
  )
}

function toastWithText(page: Page, text: string) {
  return page.locator('[data-sonner-toast]', { hasText: text })
}

test.describe('Error toasts', () => {
  test.beforeEach(async ({ mockPage }) => {
    await expect(mockPage.getByText('Test Project').first()).toBeVisible({
      timeout: 5000,
    })
  })

  test('stay until closed while success toasts time out', async ({
    mockPage,
  }) => {
    await showToast(mockPage, 'loadingThenError', 'Push failed', 'rejected')
    await showToast(mockPage, 'success', 'Pushed')
    // Move the pointer off the toasts: hover pauses sonner's timers.
    await mockPage.mouse.move(10, 10)

    const errorToast = toastWithText(mockPage, 'Push failed')
    await expect(toastWithText(mockPage, 'Pushed')).toHaveCount(0, {
      timeout: 8000,
    })
    await expect(errorToast).toBeVisible()

    await errorToast.hover()
    await errorToast.getByRole('button', { name: 'Close toast' }).click()
    await expect(errorToast).toHaveCount(0)
  })

  test('right-click copies title and description', async ({
    mockPage,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await showToast(
      mockPage,
      'error',
      'Push failed',
      'remote: permission denied'
    )

    await toastWithText(mockPage, 'Push failed').click({ button: 'right' })
    await mockPage.getByRole('menuitem', { name: 'Copy error' }).click()

    await expect(mockPage.getByText('Error copied')).toBeVisible()
    expect(await mockPage.evaluate(() => navigator.clipboard.readText())).toBe(
      'Push failed\nremote: permission denied'
    )
  })
})
