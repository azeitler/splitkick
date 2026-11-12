import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'html' : 'list',
  timeout: 30_000,

  use: {
    baseURL: 'http://localhost:1421',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
    // WebKit is the desktop app's engine on macOS. Specs that guard what only
    // the desktop app showed wrong run here too (#135).
    {
      name: 'webkit',
      use: { browserName: 'webkit' },
      testMatch: /(toast-visibility|app-update-flow)\.spec\.ts$/,
    },
  ],

  webServer: {
    command: 'bun run dev:e2e',
    port: 1421,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})
