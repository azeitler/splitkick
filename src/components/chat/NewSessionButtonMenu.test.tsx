import { fireEvent, render, screen } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '@/components/ui/button'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { NewSessionButtonMenuContent } from './NewSessionButtonMenu'

function PlusButton({
  onClick,
  onNewAgentSession,
}: {
  onClick: () => void
  onNewAgentSession: () => void
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Button aria-label="New session" onClick={onClick}>
          +
        </Button>
      </ContextMenuTrigger>
      <NewSessionButtonMenuContent onNewAgentSession={onNewAgentSession} />
    </ContextMenu>
  )
}

describe('NewSessionButtonMenuContent (#109)', () => {
  it('a plain click keeps the button action and opens no menu', async () => {
    const onClick = vi.fn()
    const onNewAgentSession = vi.fn()
    render(
      <PlusButton onClick={onClick} onNewAgentSession={onNewAgentSession} />
    )
    await userEvent.click(screen.getByRole('button', { name: 'New session' }))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(
      screen.queryByRole('menuitem', { name: /New Session from Agent/ })
    ).not.toBeInTheDocument()
    expect(onNewAgentSession).not.toHaveBeenCalled()
  })

  it('right-click offers "New Session from Agent…"', async () => {
    const onClick = vi.fn()
    const onNewAgentSession = vi.fn()
    render(
      <PlusButton onClick={onClick} onNewAgentSession={onNewAgentSession} />
    )
    fireEvent.contextMenu(screen.getByRole('button', { name: 'New session' }))
    await userEvent.click(
      await screen.findByRole('menuitem', { name: /New Session from Agent/ })
    )
    expect(onNewAgentSession).toHaveBeenCalledTimes(1)
    expect(onClick).not.toHaveBeenCalled()
  })
})
