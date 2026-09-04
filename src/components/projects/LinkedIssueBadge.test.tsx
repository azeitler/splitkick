import { describe, expect, it } from 'vitest'
import { render, screen } from '@/test/test-utils'
import { LinkedIssueBadge } from './LinkedIssueBadge'

describe('LinkedIssueBadge', () => {
  it('shows the issue number', () => {
    render(<LinkedIssueBadge issueNumber={123} />)

    expect(screen.getByTestId('linked-issue-badge')).toHaveTextContent('123')
  })

  it('gives an accessible label naming the issue', () => {
    render(<LinkedIssueBadge issueNumber={123} />)

    expect(screen.getByLabelText('GitHub issue 123')).toBeInTheDocument()
  })

  it('renders nothing when no issue is linked', () => {
    render(<LinkedIssueBadge issueNumber={undefined} />)

    expect(screen.queryByTestId('linked-issue-badge')).toBeNull()
  })

  it('renders nothing for issue number zero', () => {
    render(<LinkedIssueBadge issueNumber={0} />)

    expect(screen.queryByTestId('linked-issue-badge')).toBeNull()
  })
})
