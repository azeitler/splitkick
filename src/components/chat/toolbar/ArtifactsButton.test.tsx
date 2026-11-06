import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@/test/test-utils'
import { useUIStore } from '@/store/ui-store'
import { ArtifactsButton } from './ArtifactsButton'

describe('ArtifactsButton (#107)', () => {
  beforeEach(() => {
    useUIStore.setState({ fileBrowserVisible: false, contextPanelTab: 'files' })
  })

  it('is hidden while there are no artifacts', () => {
    render(<ArtifactsButton count={0} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows the count and opens or closes the Artifacts tab', () => {
    render(<ArtifactsButton count={3} />)
    expect(screen.getByTestId('artifacts-badge')).toHaveTextContent('3')
    const button = screen.getByRole('button', { name: 'Artifacts (3)' })

    fireEvent.click(button)
    expect(useUIStore.getState().fileBrowserVisible).toBe(true)
    expect(useUIStore.getState().contextPanelTab).toBe('artifacts')
    expect(button).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(button)
    expect(useUIStore.getState().fileBrowserVisible).toBe(false)
  })
})
