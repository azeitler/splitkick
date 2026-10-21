import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/transport', () => ({ invoke: vi.fn(async () => undefined) }))

import { invoke } from '@/lib/transport'
import { relaunchApp } from './relaunch'

describe('relaunchApp', () => {
  it('asks the native shell to relaunch', async () => {
    await relaunchApp()
    expect(invoke).toHaveBeenCalledWith('relaunch_app')
  })
})
