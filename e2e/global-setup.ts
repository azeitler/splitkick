import { chromium, type FullConfig } from '@playwright/test'

/**
 * Warm the Vite dev server before the workers start (issue #148).
 *
 * On a cold server the first page load transforms hundreds of modules and
 * pre-bundles the dependencies. With several workers loading at once on a
 * busy machine, pages stayed on the loading spinner past the test timeout.
 * One load here, until the network is idle, does that work once.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL
  if (!baseURL) return
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.goto(baseURL, { waitUntil: 'networkidle', timeout: 180_000 })
  } finally {
    await browser.close()
  }
}
