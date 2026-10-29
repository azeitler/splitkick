import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { FollowUpsPanel, moveFollowUp } from './FollowUpsPanel'
import type { FollowUp, FollowUpOp } from '@/types/chat'

const { mobileState } = vi.hoisted(() => ({ mobileState: { value: false } }))

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => mobileState.value,
}))

const item = (id: string, text: string, done = false): FollowUp => ({
  id,
  text,
  done,
  created_at: 0,
})

const items = [
  item('a', 'check the tests'),
  item('b', 'rename X', true),
  item('c', 'ask about Y'),
]

function renderPanel(
  overrides: Partial<Parameters<typeof FollowUpsPanel>[0]> = {}
) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    items,
    isSessionBusy: false,
    onEdit: vi.fn(async (_op: FollowUpOp) => true),
    onUse: vi.fn(),
    onQueue: vi.fn(),
    ...overrides,
  }
  render(<FollowUpsPanel {...props} />)
  return props as typeof props & { onEdit: ReturnType<typeof vi.fn> }
}

describe('FollowUpsPanel', () => {
  beforeEach(() => {
    mobileState.value = false
  })

  it('renders nothing on desktop while closed', () => {
    renderPanel({ open: false })
    expect(screen.queryByRole('dialog', { name: 'Follow-ups' })).toBeNull()
  })

  it('floats above the composer by default', () => {
    renderPanel()
    const panel = screen.getByRole('dialog', { name: 'Follow-ups' })
    expect(panel).toHaveAttribute('data-placement', 'above')
    expect(panel.className).toContain('bottom-full')
  })

  it('sits in the side column when placed beside the chat', () => {
    renderPanel({ placement: 'beside' })
    const panel = screen.getByRole('dialog', { name: 'Follow-ups' })
    expect(panel).toHaveAttribute('data-placement', 'beside')
    expect(panel.className).not.toContain('absolute')
  })

  it('adds a note on Enter and clears the input', async () => {
    const { onEdit } = renderPanel()
    const input = screen.getByLabelText('New follow-up') as HTMLInputElement
    fireEvent.change(input, { target: { value: '  new idea ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onEdit).toHaveBeenCalledWith({ kind: 'add', text: 'new idea' })
    await waitFor(() => expect(input.value).toBe(''))
  })

  it('does not add an empty note', () => {
    const { onEdit } = renderPanel()
    const input = screen.getByLabelText('New follow-up')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onEdit).not.toHaveBeenCalled()
  })

  it('ticks an item off and back on', () => {
    const { onEdit } = renderPanel()
    const [first, second] = screen.getAllByRole('checkbox')
    fireEvent.click(first as HTMLElement)
    expect(onEdit).toHaveBeenCalledWith({ kind: 'update', id: 'a', done: true })
    fireEvent.click(second as HTMLElement)
    expect(onEdit).toHaveBeenCalledWith({
      kind: 'update',
      id: 'b',
      done: false,
    })
  })

  it('shows done items greyed out', () => {
    renderPanel()
    expect(screen.getByText('rename X').className).toContain('line-through')
    expect(screen.getByText('check the tests').className).not.toContain(
      'line-through'
    )
  })

  it('edits an item inline: Enter saves, Escape cancels', async () => {
    const { onEdit } = renderPanel()
    fireEvent.click(
      screen.getAllByLabelText('Edit follow-up').at(0) as HTMLElement
    )
    const input = screen.getByLabelText('Follow-up text')
    fireEvent.change(input, { target: { value: 'check all tests' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onEdit).toHaveBeenCalledWith({
      kind: 'update',
      id: 'a',
      text: 'check all tests',
    })
    await waitFor(() =>
      expect(screen.queryByLabelText('Follow-up text')).toBeNull()
    )

    onEdit.mockClear()
    fireEvent.click(
      screen.getAllByLabelText('Edit follow-up').at(0) as HTMLElement
    )
    fireEvent.keyDown(screen.getByLabelText('Follow-up text'), {
      key: 'Escape',
    })
    expect(onEdit).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Follow-up text')).toBeNull()
  })

  it('deletes an item', () => {
    const { onEdit } = renderPanel()
    fireEvent.click(
      screen.getAllByLabelText('Delete follow-up').at(2) as HTMLElement
    )
    expect(onEdit).toHaveBeenCalledWith({ kind: 'remove', id: 'c' })
  })

  it('uses an item', () => {
    const { onUse } = renderPanel()
    fireEvent.click(
      screen.getAllByLabelText('Use in message').at(0) as HTMLElement
    )
    expect(onUse).toHaveBeenCalledWith(items[0])
  })

  it('offers Queue only while the session is busy', () => {
    renderPanel()
    expect(screen.queryByLabelText('Queue for after this turn')).toBeNull()
  })

  it('queues an item while the session is busy', () => {
    const { onQueue } = renderPanel({ isSessionBusy: true })
    fireEvent.click(
      screen.getAllByLabelText('Queue for after this turn').at(2) as HTMLElement
    )
    expect(onQueue).toHaveBeenCalledWith(items[2])
  })

  it('clears done items, and hides the button when none are done', () => {
    const { onEdit } = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Clear done' }))
    expect(onEdit).toHaveBeenCalledWith({ kind: 'clear_done' })
  })

  it('hides Clear done when no item is done', () => {
    renderPanel({ items: [item('a', 'open')] })
    expect(screen.queryByRole('button', { name: 'Clear done' })).toBeNull()
  })

  it('moves a focused item with Alt+Arrow keys', () => {
    const { onEdit } = renderPanel()
    const rows = screen.getAllByRole('listitem')
    fireEvent.keyDown(rows.at(2) as HTMLElement, {
      key: 'ArrowUp',
      altKey: true,
    })
    expect(onEdit).toHaveBeenCalledWith({
      kind: 'reorder',
      ids: ['a', 'c', 'b'],
    })
  })

  it('reorders by drag and drop', () => {
    const { onEdit } = renderPanel()
    const rows = screen.getAllByRole('listitem')
    const dataTransfer = { effectAllowed: '' }
    fireEvent.dragStart(rows.at(0) as HTMLElement, { dataTransfer })
    fireEvent.dragOver(rows.at(2) as HTMLElement, { dataTransfer })
    fireEvent.drop(rows.at(2) as HTMLElement, { dataTransfer })
    expect(onEdit).toHaveBeenCalledWith({
      kind: 'reorder',
      ids: ['b', 'c', 'a'],
    })
  })

  it('closes on Escape', () => {
    const { onOpenChange } = renderPanel()
    fireEvent.keyDown(screen.getByLabelText('New follow-up'), {
      key: 'Escape',
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('renders a bottom sheet on phones', () => {
    mobileState.value = true
    renderPanel()
    expect(screen.queryByRole('dialog', { name: 'Follow-ups' })).not.toBeNull()
    expect(document.querySelector('[data-slot="sheet-content"]')).not.toBeNull()
    expect(screen.getByLabelText('New follow-up')).not.toBe(
      document.activeElement
    )
  })
})

describe('moveFollowUp', () => {
  it('moves an id to the place of the target', () => {
    expect(moveFollowUp(items, 'a', 'c')).toEqual(['b', 'c', 'a'])
    expect(moveFollowUp(items, 'c', 'a')).toEqual(['c', 'a', 'b'])
  })

  it('keeps the order for unknown ids', () => {
    expect(moveFollowUp(items, 'x', 'a')).toEqual(['a', 'b', 'c'])
  })
})
