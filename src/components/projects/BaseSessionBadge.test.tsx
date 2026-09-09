import { describe, expect, it } from 'vitest'
import { render, screen } from '@/test/test-utils'
import { BaseSessionBadge } from './BaseSessionBadge'

describe('BaseSessionBadge', () => {
  it('names the base session', () => {
    render(<BaseSessionBadge />)

    expect(screen.getByTestId('base-session-badge')).toHaveTextContent(
      'Base Session'
    )
  })

  it('is not interactive, because its rows already are', () => {
    render(<BaseSessionBadge />)

    expect(screen.queryByRole('button')).toBeNull()
  })

  it('keeps the caller className', () => {
    render(<BaseSessionBadge className="ml-2" />)

    expect(screen.getByTestId('base-session-badge')).toHaveClass('ml-2')
  })
})
