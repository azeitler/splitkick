import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { render } from '@/test/test-utils'
import { useUIStore } from '@/store/ui-store'
import { UpdateCheckResultDialog } from './UpdateCheckResultDialog'

describe('UpdateCheckResultDialog', () => {
  afterEach(() => {
    useUIStore.setState({ updateCheckResult: null })
  })

  it('shows nothing without a result', () => {
    render(<UpdateCheckResultDialog />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows the answer in an in-app dialog and closes on OK', async () => {
    useUIStore.setState({
      updateCheckResult: {
        text: 'You are running the latest version (1.5.24).',
        kind: 'info',
      },
    })
    render(<UpdateCheckResultDialog />)

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Check for Updates')
    expect(dialog).toHaveTextContent(
      'You are running the latest version (1.5.24).'
    )

    await userEvent.setup().click(screen.getByRole('button', { name: 'OK' }))
    expect(useUIStore.getState().updateCheckResult).toBeNull()
  })

  it('shows an error result', () => {
    useUIStore.setState({
      updateCheckResult: {
        text: 'The update check failed: offline',
        kind: 'error',
      },
    })
    render(<UpdateCheckResultDialog />)
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'The update check failed: offline'
    )
  })
})
