import { beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({ native: false }))
vi.mock('@/lib/environment', () => ({
  isNativeApp: () => env.native,
  isLocalBackend: () => env.native,
}))
vi.mock('@/hooks/use-mobile', () => ({ isMobileViewport: () => true }))

import { defaultUIState } from '@/types/ui-state'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import { getCurrentUIState, rememberHostView } from './ui-state-snapshot'

describe('getCurrentUIState view fields (#72)', () => {
  beforeEach(() => {
    rememberHostView({
      ...defaultUIState,
      active_project_id: 'desktop-project',
      active_worktree_id: 'desktop-worktree',
      active_worktree_path: '/repo/desktop-worktree',
      last_active_worktree_id: 'desktop-worktree',
      mobile_active_tab: 'home',
      zen_mode: true,
    })
    useProjectsStore.setState({ selectedProjectId: 'phone-project' })
    useChatStore.setState({
      activeWorktreeId: null,
      activeWorktreePath: null,
    })
    useUIStore.setState({ mobileActiveTab: 'history', zenMode: false })
  })

  it('writes the host view back in Web Access', () => {
    env.native = false
    expect(getCurrentUIState()).toMatchObject({
      active_project_id: 'desktop-project',
      active_worktree_id: 'desktop-worktree',
      active_worktree_path: '/repo/desktop-worktree',
      last_active_worktree_id: 'desktop-worktree',
      mobile_active_tab: 'home',
      zen_mode: true,
    })
  })

  it('writes its own view in the native app', () => {
    env.native = true
    expect(getCurrentUIState()).toMatchObject({
      active_project_id: 'phone-project',
      active_worktree_id: null,
      mobile_active_tab: 'history',
      zen_mode: false,
    })
  })
})
