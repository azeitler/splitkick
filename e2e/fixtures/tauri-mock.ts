/**
 * Playwright test fixture that injects E2E mock transport.
 * Usage: import { test, expect } from '../fixtures/tauri-mock'
 */

import { test as base, expect, type Page } from '@playwright/test'
import { defaultResponses } from './invoke-handlers'

interface TauriMockFixtures {
  /** Page with Tauri mocks injected. Navigates to '/' automatically. */
  mockPage: Page
  /** Override specific command responses for this test. */
  responseOverrides: Record<string, unknown>
  /** Emit a backend event to the app (simulates Rust → React events). */
  emitEvent: (event: string, payload: unknown) => Promise<void>
}

export const test = base.extend<TauriMockFixtures>({
  // Default: no overrides. Tests can set this via test.use({})
  responseOverrides: [{}, { option: true }],

  mockPage: async ({ page, responseOverrides }, use) => {
    const responses = { ...defaultResponses, ...responseOverrides }

    // Pass plain JSON data — no function serialization needed
    await page.addInitScript((responseMap: Record<string, unknown>) => {
      // Commands that need dynamic responses based on args
      const dynamicHandlers: Record<
        string,
        (args?: Record<string, unknown>) => unknown
      > = {
        get_sessions: (args) => ({
          worktree_id: args?.worktreeId ?? 'unknown',
          sessions: [],
          active_session_id: null,
          version: 2,
        }),
      }

      const handlers: Record<string, (args?: any) => unknown> = {}

      for (const [cmd, data] of Object.entries(responseMap)) {
        if (dynamicHandlers[cmd]) {
          handlers[cmd] = dynamicHandlers[cmd]
        } else {
          handlers[cmd] = () => structuredClone(data)
        }
      }

      ;(window as any).__JEAN_E2E_MOCK__ = {
        invokeHandlers: handlers,
        eventEmitter: new EventTarget(),
      }
    }, responses)

    await page.goto('/')
    await use(page)
  },

  emitEvent: async ({ mockPage }, use) => {
    const emitFn = async (event: string, payload: unknown) => {
      await mockPage.evaluate(
        ({ event, payload }) => {
          const emitter = (window as any).__JEAN_E2E_MOCK__?.eventEmitter
          if (emitter) {
            emitter.dispatchEvent(new CustomEvent(event, { detail: payload }))
          }
        },
        { event, payload }
      )
    }
    await use(emitFn)
  },
})

export { expect }
