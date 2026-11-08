import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { SendCancelButton } from './SendCancelButton'

const { useIsMobileMock } = vi.hoisted(() => ({
  useIsMobileMock: vi.fn(() => false),
}))

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => useIsMobileMock(),
}))

vi.mock('@/lib/platform', () => ({
  getModifierSymbol: () => '⌘',
  isClientMacOS: true,
  isMacOS: true,
}))

describe('SendCancelButton', () => {
  it('renders a generic Send label while idle', () => {
    const { container } = render(
      <SendCancelButton
        isSending={false}
        canSend
        queuedMessageCount={0}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /^plan$/i })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /^build$/i })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /^yolo$/i })
    ).not.toBeInTheDocument()
    expect(container.querySelector('svg')).toBeNull()
  })

  it('renders Cancel while sending without queueing', () => {
    render(
      <SendCancelButton
        isSending
        canSend={false}
        queuedMessageCount={0}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /queue/i })
    ).not.toBeInTheDocument()
  })

  it('renders Queue while sending and another message can be queued', () => {
    const { container } = render(
      <SendCancelButton
        isSending
        canSend
        queuedMessageCount={1}
        onCancel={vi.fn()}
      />
    )

    expect(
      screen.getByRole('button', { name: /skip to next/i })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /queue/i })).toBeInTheDocument()
    expect(screen.getByText('Enter')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /^steer$/i })
    ).not.toBeInTheDocument()
    expect(container.querySelector('svg')).toBeNull()
  })

  it('renders Steer instead of Queue when auto-steer is enabled', () => {
    render(
      <SendCancelButton
        isSending
        canSend
        willSteer
        queuedMessageCount={0}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^steer$/i })).toBeInTheDocument()
    expect(screen.getByText('Enter')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /^queue$/i })
    ).not.toBeInTheDocument()
  })

  it('renders the modifier shortcut when steer is temporarily forced', () => {
    render(
      <SendCancelButton
        isSending
        canSend
        willSteer
        steerWithModifier
        queuedMessageCount={0}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: /^steer$/i })).toHaveTextContent(
      '⌘↵'
    )
  })

  it('renders the primary send/cancel action before queue or steer', () => {
    render(
      <SendCancelButton
        isSending
        canSend
        queuedMessageCount={0}
        onCancel={vi.fn()}
      />
    )

    const queue = screen.getByRole('button', { name: /^queue$/i })
    const cancel = screen.getByRole('button', { name: /cancel/i })
    expect(
      cancel.compareDocumentPosition(queue) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })
})

describe('SendCancelButton while a turn runs (#114)', () => {
  it('gives Queue the primary style, not Cancel', () => {
    render(
      <SendCancelButton
        isSending
        canSend
        queuedMessageCount={0}
        onCancel={vi.fn()}
      />
    )

    const queue = screen.getByRole('button', { name: /^queue$/i })
    const cancel = screen.getByRole('button', { name: /cancel/i })
    expect(queue).toHaveClass('bg-primary', 'text-primary-foreground')
    expect(cancel).not.toHaveClass('bg-primary')
    expect(cancel).toHaveClass('text-muted-foreground')
  })

  it('gives Steer the primary style when it replaces Queue', () => {
    render(
      <SendCancelButton
        isSending
        canSend
        willSteer
        queuedMessageCount={0}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: /^steer$/i })).toHaveClass(
      'bg-primary'
    )
    expect(screen.getByRole('button', { name: /cancel/i })).not.toHaveClass(
      'bg-primary'
    )
  })

  it('keeps Cancel secondary when it is the only action', () => {
    render(
      <SendCancelButton
        isSending
        canSend={false}
        queuedMessageCount={0}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: /cancel/i })).not.toHaveClass(
      'bg-primary'
    )
  })
})

describe('SendCancelButton keeps the composer focused (#114)', () => {
  // A tap on a composer action must not take focus from the textarea: on iOS
  // that closes the soft keyboard and the shell jumps down under the finger.
  it.each([
    ['Send', { isSending: false, canSend: true }, /^send$/i],
    ['Queue', { isSending: true, canSend: true }, /^queue$/i],
    ['Cancel', { isSending: true, canSend: false }, /cancel/i],
  ])('prevents the focus change on mousedown of %s', (_, props, name) => {
    render(
      <SendCancelButton {...props} queuedMessageCount={0} onCancel={vi.fn()} />
    )

    const button = screen.getByRole('button', { name })
    // fireEvent returns false when a handler called preventDefault().
    expect(fireEvent.mouseDown(button)).toBe(false)
  })

  it('still sends on click with the textarea focused', () => {
    const onSubmit = vi.fn((e: Event) => e.preventDefault())
    render(
      <form onSubmit={e => onSubmit(e.nativeEvent)}>
        <textarea aria-label="prompt" />
        <SendCancelButton
          isSending={false}
          canSend
          queuedMessageCount={0}
          onCancel={vi.fn()}
        />
      </form>
    )

    const textarea = screen.getByLabelText('prompt')
    textarea.focus()
    const send = screen.getByRole('button', { name: /^send$/i })
    fireEvent.mouseDown(send)
    fireEvent.click(send)

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(textarea)
  })
})

describe('SendCancelButton touch target', () => {
  afterEach(() => {
    useIsMobileMock.mockReturnValue(false)
  })

  it('grows Send to 44px on a phone', () => {
    // The most-tapped control in the composer. Uses the component's own
    // useIsMobile rather than a viewport prefix, because the surrounding
    // toolbar is container-query driven.
    useIsMobileMock.mockReturnValue(true)

    render(
      <SendCancelButton
        isSending={false}
        canSend
        queuedMessageCount={0}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: /send/i })).toHaveClass('h-11')
  })

  it('keeps the compact height on desktop', () => {
    render(
      <SendCancelButton
        isSending={false}
        canSend
        queuedMessageCount={0}
        onCancel={vi.fn()}
      />
    )

    const button = screen.getByRole('button', { name: /send/i })
    expect(button).toHaveClass('h-8')
    expect(button).not.toHaveClass('h-11')
  })

  it('grows Cancel to 44px on a phone too', () => {
    useIsMobileMock.mockReturnValue(true)

    render(
      <SendCancelButton
        isSending
        canSend={false}
        queuedMessageCount={0}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: /cancel/i })).toHaveClass('h-11')
  })

  it('offers Send later and Repeat in the Send menu (#38)', async () => {
    const onSchedule = vi.fn()
    render(
      <SendCancelButton
        isSending={false}
        canSend
        onCancel={vi.fn()}
        onSchedule={onSchedule}
      />
    )

    await userEvent.click(
      screen.getByRole('button', { name: /more send options/i })
    )
    await userEvent.click(
      await screen.findByRole('menuitem', { name: /send later/i })
    )
    expect(onSchedule).toHaveBeenCalledWith('once')

    await userEvent.click(
      screen.getByRole('button', { name: /more send options/i })
    )
    await userEvent.click(
      await screen.findByRole('menuitem', { name: /repeat/i })
    )
    expect(onSchedule).toHaveBeenCalledWith('repeat')
  })

  it('has no Send menu without a schedule handler', () => {
    render(<SendCancelButton isSending={false} canSend onCancel={vi.fn()} />)
    expect(
      screen.queryByRole('button', { name: /more send options/i })
    ).not.toBeInTheDocument()
  })
})
