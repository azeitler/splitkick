import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MessageMetaLine } from './MessageMetaLine'
import { useUIStore } from '@/store/ui-store'
import { formatMessageTimestamp } from '@/lib/relative-time'

const AT = Math.floor(new Date(2026, 8, 1, 14, 32).getTime() / 1000)

describe('MessageMetaLine', () => {
  beforeEach(() => {
    useUIStore.setState({ zenMode: false })
  })

  it('renders the timestamp and the turn runtime side by side', () => {
    render(<MessageMetaLine timestamp={AT} durationMs={145_000} />)

    expect(screen.getByText(formatMessageTimestamp(AT))).toBeVisible()
    expect(screen.getByText('02:25')).toBeVisible()
  })

  // Guards the promise that adding timestamps never hides the runtime.
  it('renders the runtime even when no timestamp is given', () => {
    render(<MessageMetaLine durationMs={145_000} />)

    expect(screen.getByText('02:25')).toBeVisible()
  })

  it('keeps the runtime in zen mode and drops only the timestamp', () => {
    useUIStore.setState({ zenMode: true })
    render(<MessageMetaLine timestamp={AT} durationMs={145_000} />)

    expect(screen.getByText('02:25')).toBeVisible()
    expect(screen.queryByText(formatMessageTimestamp(AT))).toBeNull()
  })

  it('omits the runtime when it is zero or missing', () => {
    const { container } = render(
      <MessageMetaLine timestamp={AT} durationMs={0} />
    )

    expect(screen.getByText(formatMessageTimestamp(AT))).toBeVisible()
    expect(container.textContent).toBe(formatMessageTimestamp(AT))
  })

  it('renders extra meta segments passed as children', () => {
    render(
      <MessageMetaLine timestamp={AT} durationMs={null}>
        <span>(cancelled)</span>
      </MessageMetaLine>
    )

    expect(screen.getByText('(cancelled)')).toBeVisible()
  })

  it('renders nothing when there is no meta content at all', () => {
    const { container } = render(<MessageMetaLine />)

    expect(container).toBeEmptyDOMElement()
  })
})
