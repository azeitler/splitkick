import { describe, expect, it, vi, beforeEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen, waitFor } from '@/test/test-utils'
import { invoke } from '@/lib/transport'
import { OpinionatedPane } from './OpinionatedPane'

vi.mock('@/lib/transport', () => ({
  invoke: vi.fn(),
}))

vi.mock('@/lib/platform', () => ({
  openExternal: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    loading: vi.fn(() => 'toast-id'),
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('OpinionatedPane', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(invoke).mockImplementation(async command => {
      if (command === 'check_opinionated_plugin_status') {
        return { installed: true, version: 'codex' }
      }
      if (command === 'uninstall_opinionated_plugin') {
        return 'Uninstalled'
      }
      throw new Error(`Unexpected command ${command}`)
    })
  })

  it('shows uninstall for installed skill packs and invokes uninstall command', async () => {
    const user = userEvent.setup()

    render(<OpinionatedPane />)

    await screen.findByRole('button', { name: /Superpowers/i })

    const uninstallButtons = screen.getAllByRole('button', { name: /Uninstall/i })
    const superpowersUninstall = uninstallButtons[1]
    expect(superpowersUninstall).toBeDefined()
    await user.click(superpowersUninstall!)

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('uninstall_opinionated_plugin', {
        pluginName: 'superpowers',
      })
    })
  })
})
