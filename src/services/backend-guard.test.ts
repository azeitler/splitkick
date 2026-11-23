import { beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({ connected: false, transport: true }))

vi.mock('@/lib/transport', () => ({
  invoke: vi.fn(() => Promise.resolve('plan text')),
}))

vi.mock('@/lib/environment', async importOriginal => ({
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  ...(await importOriginal<typeof import('@/lib/environment')>()),
  hasBackend: () => env.connected,
  hasBackendTransport: () => env.transport,
}))

import { invoke } from '@/lib/transport'
import { NO_BACKEND_ERROR } from '@/lib/environment'
import { readPlanFile } from './chat'

/**
 * A remote connection that reconnects is not connected for a moment. An
 * action then must go to the transport, which queues it until the socket is
 * back, not fail at once with "Not in Tauri context".
 */
describe('backend guard of actions', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockClear()
    env.connected = false
    env.transport = true
  })

  it('sends the call while the remote connection reconnects', async () => {
    await expect(readPlanFile('/tmp/plan.md')).resolves.toBe('plan text')
    expect(invoke).toHaveBeenCalledWith('read_plan_file', {
      path: '/tmp/plan.md',
    })
  })

  it('fails with a clear error when there is no backend at all', async () => {
    env.transport = false
    await expect(readPlanFile('/tmp/plan.md')).rejects.toThrow(NO_BACKEND_ERROR)
    expect(invoke).not.toHaveBeenCalled()
  })
})
