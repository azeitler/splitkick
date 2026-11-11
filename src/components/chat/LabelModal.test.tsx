import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { LabelModal } from './LabelModal'
import { useChatStore } from '@/store/chat-store'

const bug = { name: 'Bug', color: '#ef4444' }
const ux = { name: 'UX', color: '#3b82f6' }

function renderModal(onColorChange = vi.fn()) {
  render(
    <LabelModal
      isOpen
      onClose={vi.fn()}
      sessionId={null}
      currentLabel={null}
      currentLabels={[bug]}
      mode="multi"
      onApplyLabels={vi.fn()}
      onColorChange={onColorChange}
      extraLabels={[bug, ux]}
    />
  )
  return onColorChange
}

describe('LabelModal: edit a label', () => {
  beforeEach(() => {
    useChatStore.setState({ sessionLabels: { 's-1': bug, 's-2': ux } })
  })

  it('renames a label everywhere it is used', async () => {
    const user = userEvent.setup()
    const onColorChange = renderModal()

    await user.click(screen.getByRole('button', { name: 'Edit label Bug' }))
    const name = screen.getByRole('textbox', { name: 'Label name' })
    await user.clear(name)
    await user.type(name, 'Defect')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(onColorChange).toHaveBeenCalledWith('Bug', bug.color, 'Defect')
    expect(useChatStore.getState().sessionLabels['s-1']).toEqual({
      name: 'Defect',
      color: bug.color,
    })
    expect(useChatStore.getState().sessionLabels['s-2']).toEqual(ux)
  })

  it('does not save an empty name or the name of another label', async () => {
    const user = userEvent.setup()
    const onColorChange = renderModal()

    await user.click(screen.getByRole('button', { name: 'Edit label Bug' }))
    const name = screen.getByRole('textbox', { name: 'Label name' })
    const save = screen.getByRole('button', { name: 'Save' })

    await user.clear(name)
    expect(save).toBeDisabled()

    await user.type(name, 'ux')
    expect(save).toBeDisabled()
    expect(screen.getByText('A label with this name exists.')).toBeVisible()

    await user.click(save)
    expect(onColorChange).not.toHaveBeenCalled()
  })

  it('goes back to the list after creating a label', async () => {
    const user = userEvent.setup()
    const onApplyLabels = vi.fn()
    render(
      <LabelModal
        isOpen
        onClose={vi.fn()}
        sessionId={null}
        currentLabel={null}
        currentLabels={[]}
        mode="multi"
        onApplyLabels={onApplyLabels}
        extraLabels={[]}
      />
    )

    await user.type(screen.getByRole('textbox'), 'Bug{Enter}')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    expect(onApplyLabels).toHaveBeenCalledWith([
      expect.objectContaining({ name: 'Bug' }),
    ])
    expect(screen.queryByRole('button', { name: 'Create' })).toBeNull()
  })
})
