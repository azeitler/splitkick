import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@/test/test-utils'
import { RoleBadge } from './RoleBadge'

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({
    data: {
      role_profiles: [
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

describe('RoleBadge', () => {
  it('shows the agent name when the session was renamed', () => {
    render(<RoleBadge roleId="a1" sessionName="Roadmap upkeep" />)
    const badge = screen.getByTestId('agent-badge')
    expect(badge).toHaveTextContent('Vision keeper')
    expect(badge).toHaveAttribute('title', 'Role: Vision keeper')
  })

  it('shows only the glyph when the session has the agent name', () => {
    render(<RoleBadge roleId="a1" sessionName="Vision keeper" />)
    expect(screen.queryByTestId('agent-badge')).toBeNull()
    expect(screen.getByTestId('agent-glyph')).toHaveAttribute(
      'title',
      'Role: Vision keeper'
    )
  })

  it('renders nothing for an unknown agent', () => {
    const { container } = render(<RoleBadge roleId="gone" sessionName="x" />)
    expect(container).toBeEmptyDOMElement()
  })
})
