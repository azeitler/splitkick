import { describe, expect, it } from 'vitest'
import { render, screen } from '@/test/test-utils'
import { StreamingStatusBar } from './StreamingStatusBar'

describe('StreamingStatusBar', () => {
  const props = {
    isSending: true,
    sendStartedAt: Date.now() - 5_000,
    streamingExecutionMode: 'build' as const,
  }

  it('shows the running timer while the run works', () => {
    render(<StreamingStatusBar {...props} />)
    expect(screen.getByText(/^\d+s$/)).toBeInTheDocument()
  })

  // A question or plan waits for the user: nothing runs, so no timer counts.
  it('shows no running timer while the run waits for an answer', () => {
    const { container } = render(
      <StreamingStatusBar {...props} awaitingAnswer />
    )
    expect(container).toBeEmptyDOMElement()
  })
})
