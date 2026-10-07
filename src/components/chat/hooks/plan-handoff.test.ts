import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Transport from '@/lib/transport'
import type * as ChatService from '@/services/chat'
import { chatQueryKeys } from '@/services/chat'
import type { Session, WorktreeSessions } from '@/types/chat'
import type { AppPreferences } from '@/types/preferences'
import { createWorktreeAndWait, finishPlanHandoff } from './plan-handoff'

const invoke = vi.hoisted(() =>
  vi.fn<(command: string, args?: unknown) => Promise<unknown>>(async () => null)
)
const listeners = vi.hoisted(
  () => new Map<string, (event: { payload: unknown }) => void>()
)
const emit = (name: string, payload: unknown) =>
  listeners.get(name)?.({ payload })
const recordPlanHandoff = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('@/lib/transport', async importOriginal => ({
  ...(await importOriginal<typeof Transport>()),
  invoke,
  listen: vi.fn(
    async (name: string, handler: (event: { payload: unknown }) => void) => {
      listeners.set(name, handler)
      return () => listeners.delete(name)
    }
  ),
}))

vi.mock('@/services/chat', async importOriginal => ({
  ...(await importOriginal<typeof ChatService>()),
  recordPlanHandoff,
}))

function prefs(overrides: Partial<AppPreferences>): AppPreferences {
  return overrides as AppPreferences
}

function setup() {
  const queryClient = new QueryClient()
  queryClient.setQueryData<Session>(chatQueryKeys.session('src'), {
    id: 'src',
    pending_plan_message_id: 'pending-msg',
  } as Session)
  queryClient.setQueryData<WorktreeSessions>(chatQueryKeys.sessions('wt'), {
    worktree_id: 'wt',
    sessions: [{ id: 'src' } as Session, { id: 'new' } as Session],
    active_session_id: 'src',
  } as WorktreeSessions)
  return queryClient
}

const base = {
  worktreeId: 'wt',
  worktreePath: '/wt',
  sessionId: 'src',
  newSession: { id: 'new', name: 'Session 2' },
  mode: 'build' as const,
}

describe('finishPlanHandoff', () => {
  beforeEach(() => {
    invoke.mockClear()
    recordPlanHandoff.mockClear()
  })

  it('archives the source session when the setting is on', () => {
    const queryClient = setup()
    finishPlanHandoff({
      ...base,
      queryClient,
      prefs: prefs({
        close_original_on_clear_context: true,
        removal_behavior: 'archive',
      }),
      messageId: 'plan-msg',
    })

    expect(invoke).toHaveBeenCalledWith('archive_session', {
      worktreeId: 'wt',
      worktreePath: '/wt',
      sessionId: 'src',
    })
    expect(recordPlanHandoff).not.toHaveBeenCalled()
    const sessions = queryClient.getQueryData<WorktreeSessions>(
      chatQueryKeys.sessions('wt')
    )
    expect(sessions?.sessions.map(s => s.id)).toEqual(['new'])
    expect(sessions?.active_session_id).toBe('new')
  })

  it('closes the source session when removal behavior is delete', () => {
    finishPlanHandoff({
      ...base,
      queryClient: setup(),
      prefs: prefs({
        close_original_on_clear_context: true,
        removal_behavior: 'delete',
      }),
      messageId: 'plan-msg',
    })
    expect(invoke).toHaveBeenCalledWith('close_session', expect.anything())
  })

  it('records a handoff instead of closing when the setting is off', () => {
    const queryClient = setup()
    finishPlanHandoff({
      ...base,
      queryClient,
      prefs: prefs({ close_original_on_clear_context: false }),
      messageId: 'plan-msg',
      newWorktree: { id: 'wt2', name: 'brave-fox' },
      mode: 'yolo',
    })

    expect(invoke).not.toHaveBeenCalled()
    expect(recordPlanHandoff).toHaveBeenCalledWith(
      'wt',
      '/wt',
      'src',
      expect.objectContaining({
        message_id: 'plan-msg',
        target_session_id: 'new',
        target_worktree_id: 'wt2',
        target_worktree_name: 'brave-fox',
        kind: 'worktree',
        mode: 'yolo',
      })
    )
    const session = queryClient.getQueryData<Session>(
      chatQueryKeys.session('src')
    )
    expect(session?.plan_handoffs).toHaveLength(1)
  })

  it('falls back to the pending plan message when no message id is known', () => {
    finishPlanHandoff({
      ...base,
      queryClient: setup(),
      prefs: prefs({ close_original_on_clear_context: false }),
      messageId: null,
    })
    expect(recordPlanHandoff).toHaveBeenCalledWith(
      'wt',
      '/wt',
      'src',
      expect.objectContaining({
        message_id: 'pending-msg',
        kind: 'session',
        target_worktree_id: 'wt',
      })
    )
  })
})

describe('createWorktreeAndWait', () => {
  beforeEach(() => {
    invoke.mockReset()
    listeners.clear()
  })

  it('resolves when worktree:created fires before create_worktree returns', async () => {
    invoke.mockImplementation(async () => {
      emit('worktree:created', { worktree: { id: 'wt-new', path: '/new' } })
      return { id: 'wt-new' }
    })

    const worktree = await createWorktreeAndWait('p1', 'web/staging')

    expect(worktree.path).toBe('/new')
    expect(invoke).toHaveBeenCalledWith('create_worktree', {
      projectId: 'p1',
      baseBranch: 'web/staging',
    })
    expect(listeners.size).toBe(0)
  })

  it('ignores events of other worktrees and rejects on its own error', async () => {
    invoke.mockResolvedValue({ id: 'wt-new' })

    const pending = createWorktreeAndWait('p1')
    await vi.waitFor(() => expect(invoke).toHaveBeenCalled())
    emit('worktree:created', { worktree: { id: 'other' } })
    emit('worktree:error', { id: 'wt-new', error: 'git failed' })

    await expect(pending).rejects.toThrow('git failed')
    expect(listeners.size).toBe(0)
  })

  it('rejects when the branch already exists', async () => {
    invoke.mockImplementation(async () => {
      emit('worktree:branch_exists', { id: 'wt-new', branch: 'feat/x' })
      return { id: 'wt-new' }
    })
    await expect(createWorktreeAndWait('p1')).rejects.toThrow(
      'Branch feat/x already exists'
    )
  })
})
