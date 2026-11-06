import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@/test/test-utils'
import { useUIStore } from '@/store/ui-store'
import { SessionGraphToggle } from './SessionGraphToggle'

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({ data: undefined }),
}))

describe('SessionGraphToggle (#84, #98)', () => {
  beforeEach(() => {
    useUIStore.setState({ fileBrowserVisible: false, contextPanelTab: 'files' })
  })

  it('is hidden for a session without a graph link', () => {
    render(<SessionGraphToggle session={{ serves: [], agent_id: null }} />)
    expect(screen.queryByTestId('session-graph-toggle')).toBeNull()
  })

  it('opens and closes the left panel on its Graph tab', async () => {
    const user = userEvent.setup()
    render(<SessionGraphToggle session={{ serves: ['g1#n1'] }} />)

    const button = screen.getByRole('button', { name: 'Toggle graph panel' })
    expect(button).toHaveAttribute('aria-pressed', 'false')

    await user.click(button)
    expect(useUIStore.getState().fileBrowserVisible).toBe(true)
    expect(useUIStore.getState().contextPanelTab).toBe('graph')
    expect(button).toHaveAttribute('aria-pressed', 'true')

    await user.click(button)
    expect(useUIStore.getState().fileBrowserVisible).toBe(false)
  })

  it('is not pressed while the panel shows another tab', () => {
    useUIStore.setState({ fileBrowserVisible: true, contextPanelTab: 'files' })
    render(<SessionGraphToggle session={{ serves: ['g1#n1'] }} />)
    expect(
      screen.getByRole('button', { name: 'Toggle graph panel' })
    ).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows for a session started from an agent', () => {
    render(<SessionGraphToggle session={{ agent_id: 'a1' }} />)
    expect(screen.getByTestId('session-graph-toggle')).toHaveTextContent(
      'Graph'
    )
  })
})
