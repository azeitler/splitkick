import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@/test/test-utils'
import { useUIStore } from '@/store/ui-store'
import { TitleBar } from './TitleBar'

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => true }))
vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({ data: undefined }),
}))
vi.mock('@/lib/commands', () => ({
  useCommandContext: () => ({ openPreferences: vi.fn() }),
}))

describe('the phone title bar', () => {
  beforeEach(() => {
    useUIStore.setState({ zenMode: false })
  })

  it('is only the title', () => {
    // Settings, usage, updates and the About links moved to the Settings tab,
    // the unread count to Home, the file browser to the session header.
    render(<TitleBar title="jean" />)

    const bar = screen.getByTestId('titlebar-mobile')
    expect(bar).toHaveTextContent('jean')
    expect(bar.querySelectorAll('button')).toHaveLength(0)
    expect(screen.queryByTestId('titlebar-usage')).toBeNull()
    expect(screen.queryByTestId('toggle-file-browser')).toBeNull()
  })

  it('keeps the zen exit, since zen hides every other way out', async () => {
    useUIStore.setState({ zenMode: true })
    const user = userEvent.setup()
    render(<TitleBar title="jean" />)

    const exit = screen.getByRole('button', { name: 'Exit zen mode' })
    expect(exit).toHaveClass('size-11')
    await user.click(exit)

    expect(useUIStore.getState().zenMode).toBe(false)
  })

  it('can hide the title', () => {
    render(<TitleBar title="jean" hideTitle />)
    expect(screen.getByTestId('titlebar-mobile')).not.toHaveTextContent('jean')
  })
})
