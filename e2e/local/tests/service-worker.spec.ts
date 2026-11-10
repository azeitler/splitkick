import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import {
  freePort,
  prepareInstance,
  REPO_ROOT,
  startInstance,
  type Instance,
} from '../launcher'
import { shot } from './ui'

/**
 * Web Access service worker (#72) in WebKit, the engine of the iPhone Home
 * Screen app, against a real server with real cache headers. 127.0.0.1 is a
 * secure context, so the worker registers over plain http here.
 *
 * Own instance: the tests stop the server, which the shared instances A and
 * B must survive. The debug binary serves the repo's dist/ from disk, so run
 * `bun run build` first (test:e2e:local does).
 */
test.use({ browserName: 'webkit' })
test.describe.configure({ mode: 'serial' })

const DIST = join(REPO_ROOT, 'dist')
let instance: Instance

async function cacheState(page: Page) {
  return page.evaluate(async () => {
    const names = await caches.keys()
    const urls: string[] = []
    for (const name of names) {
      const cache = await caches.open(name)
      for (const request of await cache.keys()) {
        urls.push(new URL(request.url).pathname)
      }
    }
    return { names, urls }
  })
}

// The instance has no project, so the app opens on its welcome screen.
const appReady = (page: Page) => page.getByText('Add Your First Project')

async function openControlled(page: Page): Promise<void> {
  await page.goto(`${instance.url}/?token=${instance.token}`)
  await expect(appReady(page)).toBeVisible()
  await page.evaluate(() => navigator.serviceWorker.ready)
  // The first page load is not controlled yet; the next one is.
  await page.reload()
  await expect(appReady(page)).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true)
}

test.beforeAll(async () => {
  instance = prepareInstance('sw', await freePort())
  await startInstance(instance, [])
})

test.afterAll(() => {
  if (instance?.pid) {
    try {
      process.kill(instance.pid, 'SIGKILL')
    } catch {
      // Already stopped by the offline test.
    }
  }
})

test('caches the app shell, never the API (#72)', async ({ page }) => {
  await openControlled(page)
  // The start skeleton is hidden once the app is up.
  await expect(page.locator('#app-skeleton')).toBeHidden()

  const { names, urls } = await cacheState(page)
  expect(names).toHaveLength(1)
  expect(names[0]).toMatch(/^splitkick-shell-/)
  expect(urls).toContain('/index.html')
  expect(urls.some(url => url.startsWith('/assets/'))).toBe(true)
  for (const url of urls) {
    expect(url).not.toMatch(
      /^\/(api|ws|preview)\b|^\/(jean-build\.json|sw\.js)$/
    )
  }

  const headers = await page.evaluate(async () => {
    const sw = await fetch('/sw.js', { cache: 'no-store' })
    const manifest = await fetch('/manifest.webmanifest', { cache: 'no-store' })
    return {
      sw: sw.headers.get('cache-control'),
      manifest: manifest.headers.get('cache-control'),
      name: (await manifest.json()).name as string,
    }
  })
  expect(headers).toEqual({
    sw: 'no-store',
    manifest: 'no-store',
    name: 'Splitkick',
  })
})

test('"Reload" after a new build installs the new worker (#72)', async ({
  page,
}) => {
  const swPath = join(DIST, 'sw.js')
  const buildPath = join(DIST, 'jean-build.json')
  const sw = readFileSync(swPath, 'utf8')
  const build = readFileSync(buildPath, 'utf8')
  const newId = `e2e-${Date.now()}`
  try {
    await openControlled(page)

    // A new build on the server: new build id in sw.js and jean-build.json.
    writeFileSync(
      swPath,
      sw.replace(/const BUILD_ID = "[^"]*"/, `const BUILD_ID = "${newId}"`)
    )
    writeFileSync(
      buildPath,
      JSON.stringify({ ...JSON.parse(build), webBuildId: newId })
    )

    await page.reload()
    const toast = page.getByText('Splitkick was updated')
    await expect(toast).toBeVisible()
    await shot(page, 'sw-update-toast')
    await page.getByRole('button', { name: 'Reload' }).click()

    await expect
      .poll(async () => (await cacheState(page)).names, { timeout: 20_000 })
      .toEqual([`splitkick-shell-${newId}`])
  } finally {
    writeFileSync(swPath, sw)
    writeFileSync(buildPath, build)
  }
})

test('opens the app when the server cannot be reached (#72)', async ({
  page,
  context,
}) => {
  await openControlled(page)

  process.kill(instance.pid, 'SIGKILL')
  await expect
    .poll(async () => {
      try {
        await fetch(`${instance.url}/readyz`)
        return 'up'
      } catch {
        return 'down'
      }
    })
    .toBe('down')

  const offline = await context.newPage()
  const started = Date.now()
  // Without a worker this navigation fails with a network error page.
  await offline.goto(instance.url)
  // The start skeleton stays up while the app cannot connect.
  await expect(offline.locator('#app-skeleton')).toBeVisible()
  await expect(offline.locator('#app-skeleton .sk-desktop')).toBeVisible()
  const ms = Date.now() - started
  test.info().annotations.push({ type: 'shell-start-ms', description: `${ms}` })
  expect(await offline.title()).toBe('Splitkick')
  await shot(offline, 'sw-offline-shell')

  // Phone size, dark theme: the phone layout of the skeleton.
  const phone = await context.newPage()
  await phone.setViewportSize({ width: 390, height: 844 })
  await phone.addInitScript(() => localStorage.setItem('ui-theme', 'dark'))
  await phone.goto(instance.url)
  await expect(phone.locator('#app-skeleton .sk-phone')).toBeVisible()
  await expect(phone.locator('#app-skeleton .sk-desktop')).toBeHidden()
  await shot(phone, 'sw-offline-shell-phone-dark')
})
