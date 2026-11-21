import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@/test/test-utils'
import type { Agent } from '@/types/agents'
import { AgentBadge } from './AgentBadge'

const mocks = vi.hoisted(() => ({ agent: undefined as Agent | undefined }))

vi.mock('@/services/agents', () => ({
  useAgentForSession: () => mocks.agent,
}))

describe('AgentBadge', () => {
  beforeEach(() => {
    mocks.agent = { id: 'a1', name: 'Release manager' } as Agent
  })

  it('shows the agent name when the session has another name', () => {
    render(<AgentBadge sessionId="s1" sessionName="release work" />)
    const badge = screen.getByTestId('agent-name-badge')
    expect(badge).toHaveTextContent('Release manager')
    expect(badge).toHaveAttribute('title', 'Agent: Release manager')
  })

  it('shows only the glyph when the session carries the agent name', () => {
    render(<AgentBadge sessionId="s1" sessionName=" Release manager " />)
    const badge = screen.getByTestId('agent-name-badge')
    expect(badge).toHaveTextContent('')
    expect(badge).toHaveAttribute('aria-label', 'Agent: Release manager')
  })

  it('shows nothing for a session that is no agent', () => {
    mocks.agent = undefined
    render(<AgentBadge sessionId="s1" sessionName="x" />)
    expect(screen.queryByTestId('agent-name-badge')).toBeNull()
  })
})
