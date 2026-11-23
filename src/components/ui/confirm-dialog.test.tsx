import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { act, fireEvent, render, screen, waitFor } from '@/test/test-utils'
import {
  ConfirmDialog,
  confirmAction,
} from './confirm-dialog'

function renderDialog(onConfirm = vi.fn(), onOpenChange = vi.fn()) {
  render(
    <ConfirmDialog
      open
      onOpenChange={onOpenChange}
      title="Delete session “Acme”?"
      description="This deletes it."
      confirmLabel="Delete"
      onConfirm={onConfirm}
    />
  )
  return { onConfirm, onOpenChange }
}

const confirmButton = () => screen.getByRole('button', { name: /Delete/ })

describe('ConfirmDialog', () => {
  it('focuses the destructive confirm button', async () => {
    renderDialog()
    await waitFor(() => expect(confirmButton()).toHaveFocus())
    expect(confirmButton().className).toContain('bg-destructive')
    expect(screen.getByText('Delete session “Acme”?')).toBeInTheDocument()
  })

  it('confirms on Return', async () => {
    const { onConfirm, onOpenChange } = renderDialog()
    await waitFor(() => expect(confirmButton()).toHaveFocus())
    await userEvent.keyboard('{Enter}')
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('cancels on Esc without confirming', async () => {
    const { onConfirm, onOpenChange } = renderDialog()
    await waitFor(() => expect(confirmButton()).toHaveFocus())
    await userEvent.keyboard('{Escape}')
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('cancels with the Cancel button, also with Return on it', async () => {
    const { onConfirm, onOpenChange } = renderDialog()
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    cancel.focus()
    await userEvent.keyboard('{Enter}')
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('confirms once on a mouse click', async () => {
    const { onConfirm } = renderDialog()
    await userEvent.click(confirmButton())
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('ignores auto-repeat Return and fires only once', async () => {
    const { onConfirm } = renderDialog()
    await waitFor(() => expect(confirmButton()).toHaveFocus())
    fireEvent.keyDown(confirmButton(), { key: 'Enter', repeat: true })
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.keyDown(confirmButton(), { key: 'Enter' })
    fireEvent.keyDown(confirmButton(), { key: 'Enter' })
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('blocks keyup/keypress of a key that was down before it opened', async () => {
    renderDialog()
    await waitFor(() => expect(confirmButton()).toHaveFocus())
    // Space activates a button on keyup; WebKit activates on keypress.
    const keyUp = fireEvent.keyUp(confirmButton(), { key: ' ' })
    const keyPress = fireEvent.keyPress(confirmButton(), {
      key: 'Enter',
      charCode: 13,
    })
    expect(keyUp).toBe(false) // default prevented
    expect(keyPress).toBe(false)
  })

  it('does not confirm with the Return that opened it', async () => {
    const onConfirm = vi.fn()
    function Opener() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button
            onKeyDown={e => {
              if (e.key === 'Enter') setOpen(true)
            }}
          >
            Open
          </button>
          <ConfirmDialog
            open={open}
            onOpenChange={setOpen}
            title="Delete it?"
            confirmLabel="Delete"
            onConfirm={onConfirm}
          />
        </>
      )
    }
    render(<Opener />)
    screen.getByRole('button', { name: 'Open' }).focus()
    // Full press of Return: keydown opens; the rest lands on the dialog.
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(confirmButton()).toHaveFocus())
    expect(onConfirm).not.toHaveBeenCalled()
    // A fresh Return now confirms.
    await userEvent.keyboard('{Enter}')
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('does not pass keys to the component that rendered it', async () => {
    const parentKeyDown = vi.fn()
    render(
      <div onKeyDown={parentKeyDown}>
        <ConfirmDialog
          open
          onOpenChange={vi.fn()}
          title="Delete it?"
          confirmLabel="Delete"
          onConfirm={vi.fn()}
        />
      </div>
    )
    await waitFor(() => expect(confirmButton()).toHaveFocus())
    fireEvent.keyDown(confirmButton(), { key: 'Backspace' })
    expect(parentKeyDown).not.toHaveBeenCalled()
  })
})

describe('confirmAction', () => {
  it('resolves true on Return', async () => {
    render(<></>)
    let result: Promise<boolean> | undefined
    act(() => {
      result = confirmAction({
        title: 'Remove project “Acme”?',
        confirmLabel: 'Remove',
      })
    })
    const button = await screen.findByRole('button', { name: /Remove/ })
    await waitFor(() => expect(button).toHaveFocus())
    await userEvent.keyboard('{Enter}')
    await expect(result).resolves.toBe(true)
  })

  it('resolves false on Esc', async () => {
    render(<></>)
    let result: Promise<boolean> | undefined
    act(() => {
      result = confirmAction({
        title: 'Remove project “Acme”?',
        confirmLabel: 'Remove',
      })
    })
    await screen.findByText('Remove project “Acme”?')
    await userEvent.keyboard('{Escape}')
    await expect(result).resolves.toBe(false)
  })

  it('a new request cancels the open one', async () => {
    render(<></>)
    let first: Promise<boolean> | undefined
    act(() => {
      first = confirmAction({ title: 'First?', confirmLabel: 'Go' })
    })
    act(() => {
      void confirmAction({ title: 'Second?', confirmLabel: 'Go' })
    })
    await expect(first).resolves.toBe(false)
    expect(await screen.findByText('Second?')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
  })
})
