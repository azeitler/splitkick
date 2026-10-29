import { defineConfig } from '@playwright/test'
import { join } from 'node:path'

// Local two-instance e2e run (issue #65). See docs/developer/e2e-local.md.
function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

// Workers import this config again: keep the first run dir.
process.env.E2E_LOCAL_RUN_DIR ??= join(import.meta.dirname, '../../tmp/e2e-local', stamp())
const runDir = process.env.E2E_LOCAL_RUN_DIR

export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  // The scenarios share two instances and build on each other's data.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  outputDir: join(runDir, 'results'),
  reporter: [
    ['list'],
    ['html', { outputFolder: join(runDir, 'report'), open: 'never' }],
  ],
  use: {
    browserName: 'chromium',
    viewport: { width: 1440, height: 900 },
    screenshot: 'on',
    trace: 'retain-on-failure',
  },
})
