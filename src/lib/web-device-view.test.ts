import { beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({ native: false, connection: 'local' }))
vi.mock('@/lib/environment', () => ({ isNativeApp: () => env.native }))
vi.mock('@/lib/remote-connections', () => ({
  getActiveConnectionId: () => env.connection,
}))

import { defaultUIState, type UIState } from '@/types/ui-state'
import {
  consumeWebDeviceModal,
  peekWebDeviceView,
  resetWebDeviceModalForTests,
  saveWebDeviceView,
  webDeviceProjectId,
  withWebDeviceView,
  type WebDeviceView,
} from './web-device-view'

// The test setup stubs localStorage; give it a memory store here.
const store = new Map<string, string>()
vi.mocked(localStorage.getItem).mockImplementation(
  key => store.get(key) ?? null
)
vi.mocked(localStorage.setItem).mockImplementation((key, value) => {
  store.set(key, String(value))
})

const view: WebDeviceView = {
  projectId: 'project-1',
  activeWorktreeId: null,
  activeWorktreePath: null,
  modalWorktreeId: 'worktree-1',
  modalWorktreePath: '/repo/worktree-1',
  activeSessionId: 'session-1',
  mobileTab: 'history',
  zenMode: false,
}

const hostState: UIState = {
  ...defaultUIState,
  active_project_id: 'desktop-project',
  active_worktree_id: 'desktop-worktree',
  active_worktree_path: '/repo/desktop-worktree',
  mobile_active_tab: 'home',
  zen_mode: true,
}

describe('web device view', () => {
  beforeEach(() => {
    store.clear()
    env.native = false
    env.connection = 'local'
    resetWebDeviceModalForTests()
  })

  it('keeps the view in localStorage across reloads', () => {
    saveWebDeviceView(view)
    expect(peekWebDeviceView()).toEqual(view)
  })

  it('keeps one view per connection', () => {
    saveWebDeviceView(view)
    env.connection = 'remote-mb16'
    expect(peekWebDeviceView()).toBeNull()
  })

  it('drops a view older than 7 days', () => {
    saveWebDeviceView(view, 0)
    expect(peekWebDeviceView(8 * 24 * 60 * 60 * 1000)).toBeNull()
  })

  it('does nothing in the native app', () => {
    env.native = true
    saveWebDeviceView(view)
    expect(store.size).toBe(0)
    expect(peekWebDeviceView()).toBeNull()
  })

  it('opens Home when the saved view had no project', () => {
    expect(webDeviceProjectId('host')).toBe('host')
    saveWebDeviceView({ ...view, projectId: null })
    expect(webDeviceProjectId('host')).toBeNull()
  })

  it('gives the modal once per page load, only for its project', () => {
    saveWebDeviceView(view)
    expect(consumeWebDeviceModal('project-2')).toBeNull()
    expect(consumeWebDeviceModal('project-1')).toEqual({
      modalWorktreeId: 'worktree-1',
      modalWorktreePath: '/repo/worktree-1',
      activeSessionId: 'session-1',
    })
    expect(consumeWebDeviceModal('project-1')).toBeNull()
    // The view stays saved for the next reload.
    expect(peekWebDeviceView()).toEqual(view)
  })

  it('replaces the host view fields with the device view', () => {
    const result = withWebDeviceView(hostState, view, false)
    expect(result).toMatchObject({
      active_project_id: 'project-1',
      active_worktree_id: null,
      active_worktree_path: null,
      mobile_active_tab: 'history',
      zen_mode: false,
    })
    // Fields outside the view stay the host's.
    expect(result.expanded_project_ids).toBe(hostState.expanded_project_ids)
  })

  it('never opens the full-screen chat route on a phone', () => {
    const desktopBrowser = {
      ...view,
      activeWorktreeId: 'wt',
      activeWorktreePath: '/repo/wt',
    }
    expect(
      withWebDeviceView(hostState, desktopBrowser, true).active_worktree_id
    ).toBeNull()
    // Also without a saved view (first start on the phone).
    const firstStart = withWebDeviceView(hostState, null, true)
    expect(firstStart.active_worktree_id).toBeNull()
    expect(firstStart.active_project_id).toBe('desktop-project')
    // A desktop browser on its first start keeps the host's route.
    expect(withWebDeviceView(hostState, null, false).active_worktree_id).toBe(
      'desktop-worktree'
    )
  })
})
