import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/transport', () => ({
  invoke: vi.fn(async () => ({ installed: true, path: '/bin/claude' })),
}))

import { openBackendLoginModal } from './cli-auth'
import { queryClient } from '@/lib/query-client'
import { preferencesQueryKeys } from '@/services/preferences'
import { useUIStore } from '@/store/ui-store'

const work = { id: 'acc-work', label: 'Work', config_dir: '/u/.claude-work' }

describe('openBackendLoginModal (Claude accounts)', () => {
  beforeEach(() => {
    queryClient.setQueryData(preferencesQueryKeys.preferences(), {
      claude_accounts: [work],
      claude_active_account: 'acc-work',
    })
  })

  it('logs in to the active account, the one every run uses (#131)', async () => {
    const open = vi.spyOn(useUIStore.getState(), 'openCliLoginModal')
    expect(await openBackendLoginModal('claude')).toBe(true)
    expect(open).toHaveBeenCalledWith(
      'claude',
      'env',
      ['CLAUDE_CONFIG_DIR=/u/.claude-work', '/bin/claude', 'auth', 'login'],
      'login'
    )
  })

  it('logs in to the root install when it is active', async () => {
    queryClient.setQueryData(preferencesQueryKeys.preferences(), {
      claude_accounts: [work],
      claude_active_account: 'root',
    })
    const open = vi.spyOn(useUIStore.getState(), 'openCliLoginModal')
    expect(await openBackendLoginModal('claude')).toBe(true)
    expect(open).toHaveBeenCalledWith(
      'claude',
      '/bin/claude',
      ['auth', 'login'],
      'login'
    )
  })
})
