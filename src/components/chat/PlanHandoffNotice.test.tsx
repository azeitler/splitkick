import { fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as ChatService from '@/services/chat'
import type * as ProjectsService from '@/services/projects'
import { render } from '@/test/test-utils'
import { useChatStore } from '@/store/chat-store'
import type { PlanHandoff, Session } from '@/types/chat'
import { PlanHandoffNotice } from './PlanHandoffNotice'

const session = vi.hoisted(() => ({ current: null as Session | null }))
const dismissPlanHandoff = vi.hoisted(() => vi.fn(async () => undefined))
const archive = vi.hoisted(() => vi.fn())

vi.mock('@/services/chat', async importOriginal => ({
  ...(await importOriginal<typeof ChatService>()),
  useSession: () => ({ data: session.current }),
  dismissPlanHandoff,
}))

vi.mock('@/services/projects', async importOriginal => ({
  ...(await importOriginal<typeof ProjectsService>()),
  useWorktree: () => ({ data: { project_id: 'p1' } }),
}))

vi.mock('./hooks/useSessionArchive', () => ({
  useSessionRemoval: () => ({ archive, remove: vi.fn() }),
}))

function handoff(overrides: Partial<PlanHandoff> = {}): PlanHandoff {
  return {
    message_id: 'plan-msg',
    target_session_id: 'new',
    target_session_name: 'Session 2',
    target_worktree_id: 'wt',
    kind: 'session',
    mode: 'build',
    created_at: Math.floor(Date.now() / 1000),
    dismissed: false,
    ...overrides,
  }
}

function renderNotice(handoffs: PlanHandoff[]) {
  session.current = { id: 'src', plan_handoffs: handoffs } as Session
  return render(
    <PlanHandoffNotice
      messageId="plan-msg"
      sessionId="src"
      worktreeId="wt"
      worktreePath="/wt"
    />
  )
}

describe('PlanHandoffNotice', () => {
  beforeEach(() => {
    dismissPlanHandoff.mockClear()
    archive.mockClear()
    useChatStore.setState({ sessionStatusOverrides: {} })
  })

  it('renders nothing without a handoff for the message', () => {
    const { container } = renderNotice([handoff({ message_id: 'other' })])
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the target and the offer', () => {
    renderNotice([handoff()])
    expect(screen.getByText('Session 2')).toBeInTheDocument()
    expect(screen.getByText(/Plan sent to new session/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Mark complete/ })).toBeVisible()
    expect(screen.getByRole('button', { name: /Archive/ })).toBeVisible()
    expect(screen.getByRole('button', { name: /Continue here/ })).toBeVisible()
  })

  it('names the worktree for worktree handoffs', () => {
    renderNotice([
      handoff({ kind: 'worktree', target_worktree_name: 'brave-fox' }),
    ])
    expect(screen.getByText('brave-fox')).toBeInTheDocument()
    expect(screen.getByText(/Plan sent to new worktree/)).toBeInTheDocument()
  })

  it('hides the offer once dismissed', () => {
    renderNotice([handoff({ dismissed: true })])
    expect(screen.getByText('Session 2')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Mark complete/ })).toBeNull()
  })

  it('hides the offer when the session is completed', () => {
    useChatStore.setState({ sessionStatusOverrides: { src: 'completed' } })
    renderNotice([handoff()])
    expect(screen.queryByRole('button', { name: /Archive/ })).toBeNull()
  })

  it('Continue here dismisses the offer', () => {
    renderNotice([handoff()])
    fireEvent.click(screen.getByRole('button', { name: /Continue here/ }))
    expect(dismissPlanHandoff).toHaveBeenCalledWith(
      'wt',
      '/wt',
      'src',
      'plan-msg'
    )
  })

  it('Mark complete sets the completed status', () => {
    renderNotice([handoff()])
    fireEvent.click(screen.getByRole('button', { name: /Mark complete/ }))
    expect(useChatStore.getState().sessionStatusOverrides.src).toBe('completed')
    expect(dismissPlanHandoff).toHaveBeenCalled()
  })

  it('Archive archives the source session', () => {
    renderNotice([handoff()])
    fireEvent.click(screen.getByRole('button', { name: /Archive/ }))
    expect(archive).toHaveBeenCalledWith({
      worktreeId: 'wt',
      worktreePath: '/wt',
      sessionId: 'src',
    })
  })
})
