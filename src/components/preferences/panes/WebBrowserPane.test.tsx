import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  preferences: {} as Record<string, unknown>,
  mutate: vi.fn(),
}))

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({ data: mocks.preferences }),
  usePatchPreferences: () => ({ mutate: mocks.mutate }),
}))
vi.mock('./BrowserForAgentsSection', () => ({
  BrowserForAgentsSection: () => <div>Browser for agents section</div>,
}))

import { WebBrowserPane } from './WebBrowserPane'

describe('WebBrowserPane', () => {
  beforeEach(() => {
    mocks.preferences = {}
    mocks.mutate.mockReset()
  })

  it('shows Browser for agents and Claude in Chrome with the hint', () => {
    render(<WebBrowserPane />)
    expect(screen.getByText('Browser for agents section')).toBeInTheDocument()
    expect(screen.getByText('Claude in Chrome')).toBeInTheDocument()
    expect(screen.getByTestId('claude-chrome-hint')).toHaveTextContent(
      'Browser for agents'
    )
  })

  it('shows Claude in Chrome off when the preference is not saved', () => {
    render(<WebBrowserPane />)
    expect(screen.getByRole('switch')).not.toBeChecked()
  })

  it('saves the switch', () => {
    mocks.preferences = { chrome_enabled: true }
    render(<WebBrowserPane />)
    const toggle = screen.getByRole('switch')
    expect(toggle).toBeChecked()
    fireEvent.click(toggle)
    expect(mocks.mutate).toHaveBeenCalledWith({ chrome_enabled: false })
  })
})
