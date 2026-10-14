import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@/test/test-utils'
import { ToolbarContent, ToolbarSlotsProvider } from './toolbar-slots'
import { WindowToolbar } from './WindowToolbar'

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({ data: undefined }),
}))
vi.mock('@/components/unread/UnreadBell', () => ({ UnreadBell: () => null }))
vi.mock('@/components/home/useIsHomeActive', () => ({
  useIsHomeActive: () => false,
}))

function Shell({ children }: { children?: React.ReactNode }) {
  return (
    <ToolbarSlotsProvider>
      <WindowToolbar fallbackTitle="jean › main" />
      {children}
    </ToolbarSlotsProvider>
  )
}

const title = () => screen.getByTestId('window-toolbar')

describe('toolbar slots', () => {
  it('shows the window title when no view fills the toolbar', () => {
    render(<Shell />)
    expect(title()).toHaveTextContent('jean › main')
  })

  it('shows the content of the view on screen', () => {
    render(
      <Shell>
        <ToolbarContent
          title="Home"
          subtitle="Recent sessions"
          actions={<button type="button">Run</button>}
        />
      </Shell>
    )
    expect(title()).toHaveTextContent('Home')
    expect(title()).toHaveTextContent('Recent sessions')
    expect(title()).not.toHaveTextContent('jean › main')
    expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument()
  })

  it('gives the toolbar to the newest view and back when it closes', async () => {
    function Views() {
      const [modal, setModal] = useState(true)
      return (
        <>
          <ToolbarContent title="jean project" />
          {modal && (
            <ToolbarContent
              title="mac-toolbar session"
              actions={
                <button type="button" onClick={() => setModal(false)}>
                  Close
                </button>
              }
            />
          )}
        </>
      )
    }
    const user = userEvent.setup()
    render(
      <Shell>
        <Views />
      </Shell>
    )
    expect(title()).toHaveTextContent('mac-toolbar session')
    expect(title()).not.toHaveTextContent('jean project')

    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(title()).toHaveTextContent('jean project')
    expect(title()).not.toHaveTextContent('mac-toolbar session')
  })

  it('renders nothing without a toolbar (phone)', () => {
    render(<ToolbarContent title="Home" />)
    expect(screen.queryByText('Home')).toBeNull()
  })
})
