import { describe, expect, it } from 'vitest'
import { render, screen } from '@/test/test-utils'
import { CollapsedCountBadge } from './CollapsedCountBadge'

describe('CollapsedCountBadge', () => {
  it('shows the count', () => {
    render(<CollapsedCountBadge count={4} noun="session" />)

    expect(screen.getByTestId('collapsed-count-badge')).toHaveTextContent('4')
  })

  it('uses a singular accessible label for one child', () => {
    render(<CollapsedCountBadge count={1} noun="workspace" />)

    expect(screen.getByLabelText('1 workspace')).toBeInTheDocument()
  })

  it('uses a plural accessible label for several children', () => {
    render(<CollapsedCountBadge count={3} noun="item" />)

    expect(screen.getByLabelText('3 items')).toBeInTheDocument()
  })

  it('renders nothing when there is nothing to hide', () => {
    render(<CollapsedCountBadge count={0} noun="session" />)

    expect(screen.queryByTestId('collapsed-count-badge')).toBeNull()
  })
})
