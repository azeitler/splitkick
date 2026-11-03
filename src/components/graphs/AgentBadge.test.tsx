import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@/test/test-utils'
import { AgentBadge } from './AgentBadge'

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({
    data: {
      agent_profiles: [
        {
          id: 'a1',
          name: 'Vision keeper',
          color: '#f97316',
          persona: '',
          permission: 'manage',
          backend: null,
          model: null,
          default_serves: null,
        },
      ],
    },
  }),
}))

describe('AgentBadge', () => {
  it('shows the agent name when the session was renamed', () => {
    render(<AgentBadge agentId="a1" sessionName="Roadmap upkeep" />)
    const badge = screen.getByTestId('agent-badge')
    expect(badge).toHaveTextContent('Vision keeper')
    expect(badge).toHaveAttribute('title', 'Started from agent Vision keeper')
  })

  it('shows only the glyph when the session has the agent name', () => {
    render(<AgentBadge agentId="a1" sessionName="Vision keeper" />)
    expect(screen.queryByTestId('agent-badge')).toBeNull()
    expect(screen.getByTestId('agent-glyph')).toHaveAttribute(
      'title',
      'Started from agent Vision keeper'
    )
  })

  it('renders nothing for an unknown agent', () => {
    const { container } = render(<AgentBadge agentId="gone" sessionName="x" />)
    expect(container).toBeEmptyDOMElement()
  })
})
