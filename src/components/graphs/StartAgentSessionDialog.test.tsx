import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@/test/test-utils'
import { Dialog } from '@/components/ui/dialog'
import { useChatStore } from '@/store/chat-store'
import { StartAgentSessionForm } from './StartAgentSessionDialog'

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  navigate: vi.fn(),
}))

const profile = (id: string, name: string, permission: string) => ({
  id,
  name,
  color: '#3b82f6',
  persona: 'Keep releases tidy.',
  permission,
  backend: 'claude',
  model: 'claude-sonnet-4-6',
  default_serves: null,
})

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({
    data: { agent_profiles: [profile('a1', 'Release manager', 'write')] },
  }),
}))
vi.mock('@/services/chat', () => ({
  useCreateSession: () => ({ mutateAsync: mocks.createSession }),
}))
vi.mock('@/services/graphs', () => ({
  useGraphs: () => ({
    data: [{ id: 'g1', title: 'Splitkick roadmap', projectId: 'p1' }],
  }),
  useGraph: () => ({ data: { nodes: [] } }),
}))
vi.mock('@/services/projects', () => ({
  useProjects: () => ({ data: [{ id: 'p1', name: 'splitkick' }] }),
  useWorktrees: () => ({
    data: [
      {
        id: 'w1',
        project_id: 'p1',
        name: 'splitkick',
        path: '/repo',
        session_type: 'base',
      },
    ],
  }),
}))
vi.mock('@/lib/navigate-to-session', () => ({
  navigateToSession: mocks.navigate,
}))

describe('StartAgentSessionForm', () => {
  beforeEach(() => {
    mocks.createSession.mockReset().mockResolvedValue({ id: 'new' })
    mocks.navigate.mockReset()
  })

  const renderForm = () =>
    render(
      <Dialog open>
        <StartAgentSessionForm initialServes="g1" />
      </Dialog>
    )

  it('cannot raise the permission above the profile', () => {
    renderForm()
    expect(screen.getByRole('radio', { name: 'manage' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'read' })).toBeEnabled()
    expect(screen.getByRole('radio', { name: 'write' })).toBeChecked()
  })

  it('creates the session from the agent in one call, prefills and navigates', async () => {
    renderForm()
    await userEvent.click(screen.getByRole('radio', { name: 'read' }))
    await userEvent.type(screen.getByLabelText('First message'), 'Hello')
    await userEvent.click(screen.getByRole('button', { name: 'Start session' }))

    // The backend applies name, backend, model, permission and serves (#109).
    expect(mocks.createSession).toHaveBeenCalledTimes(1)
    expect(mocks.createSession).toHaveBeenCalledWith({
      worktreeId: 'w1',
      worktreePath: '/repo',
      agentId: 'a1',
      graphPermission: 'read',
      serves: ['g1'],
    })
    expect(useChatStore.getState().inputDrafts.new).toBe('Hello')
    expect(mocks.navigate).toHaveBeenCalledWith({
      projectId: 'p1',
      worktreeId: 'w1',
      sessionId: 'new',
    })
  })
})
