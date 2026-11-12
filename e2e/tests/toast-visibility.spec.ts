import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Locator, Page } from '@playwright/test'
import { test, expect } from '../fixtures/tauri-mock'
import {
  E2E_STYLE_NONCE,
  tauriStyleSrc,
  type TauriConfig,
} from '../fixtures/tauri-csp'

/**
 * A toast must be on screen, not only in the DOM (#135). From 1.5.9 to
 * 1.5.14 the desktop app blocked sonner's stylesheet (a nonce in its CSP),
 * so every toast sat below the window's bottom edge. `toBeVisible()` passed
 * all the same: it does not check the viewport.
 *
 * The page gets the `style-src` the built desktop app enforces, and runs in
 * Chromium and WebKit (the desktop app's engine on macOS).
 */
const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

async function applyDesktopStyleCsp(page: Page) {
  const config = JSON.parse(
    read('../../src-tauri/tauri.conf.json')
  ) as TauriConfig
  await page.addInitScript(() => {
    const violations: string[] = []
    ;(window as unknown as { __cspViolations: string[] }).__cspViolations =
      violations
    document.addEventListener('securitypolicyviolation', event => {
      violations.push(event.violatedDirective)
    })
  })
  await page.route(
    url => url.pathname === '/',
    async route => {
      const response = await route.fetch()
      const html = await response.text()
      const styleSrc = tauriStyleSrc(config, html)
      if (!styleSrc) throw new Error('tauri.conf.json has no style-src')
      // What Tauri does to the HTML: a nonce on every <style>, the CSP first.
      const body = html
        .replace(/<style(?=[\s>])/g, `<style nonce="${E2E_STYLE_NONCE}"`)
        .replace(
          '<head>',
          `<head><meta http-equiv="Content-Security-Policy" content="${styleSrc}">`
        )
      await route.fulfill({ response, body })
    }
  )
  await page.reload()
}

async function showToast(page: Page, title: string) {
  await page.evaluate(async title => {
    const url = performance
      .getEntriesByType('resource')
      .map(entry => entry.name)
      .find(name => /\/deps\/sonner\.js/.test(name))
    if (!url) throw new Error('sonner module not loaded')
    const { toast } = await import(/* @vite-ignore */ url)
    toast.success(title, {
      duration: Infinity,
      action: { label: 'Restart', onClick: () => undefined },
    })
  }, title)
}

/** In the viewport, fully faded in, and the topmost element at its centre. */
async function expectOnScreen(target: Locator) {
  await expect(target).toBeInViewport({ ratio: 1 })
  await expect
    .poll(() => target.evaluate(el => Number(getComputedStyle(el).opacity)))
    .toBeGreaterThan(0.9)
  const onTop = await target.evaluate(el => {
    const rect = el.getBoundingClientRect()
    const top = document.elementFromPoint(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2
    )
    return top !== null && el.contains(top)
  })
  expect(onTop, 'another element covers the toast').toBe(true)
}

test.describe('Toast visibility (#135)', () => {
  test('a toast is on screen under the desktop app CSP', async ({
    mockPage,
  }) => {
    await applyDesktopStyleCsp(mockPage)
    await expect(mockPage.getByText('Test Project').first()).toBeVisible({
      timeout: 10_000,
    })

    await showToast(mockPage, 'Update 9.9.9 is ready')
    const toast = mockPage.locator('[data-sonner-toast]', {
      hasText: 'Update 9.9.9 is ready',
    })
    await expectOnScreen(toast)
    await expectOnScreen(toast.getByRole('button', { name: 'Restart' }))

    const violations = await mockPage.evaluate(
      () =>
        (window as unknown as { __cspViolations: string[] }).__cspViolations
    )
    expect(violations.filter(v => v.startsWith('style-src'))).toEqual([])
  })
})
