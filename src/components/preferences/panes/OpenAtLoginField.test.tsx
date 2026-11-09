import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@/lib/transport', () => ({ invoke }))

import { OpenAtLoginSwitch } from './OpenAtLoginField'

function renderField() {
  const client = new QueryClient()
  render(
    <QueryClientProvider client={client}>
      <OpenAtLoginSwitch />
    </QueryClientProvider>
  )
}

describe('OpenAtLoginSwitch', () => {
  beforeEach(() => {
    invoke.mockReset()
    invoke.mockResolvedValue(false)
  })

  it('shows the OS state and changes it', async () => {
    renderField()
    const toggle = screen.getByRole('switch')
    await waitFor(() => expect(toggle).toBeEnabled())
    fireEvent.click(toggle)
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('set_open_at_login', {
        enabled: true,
      })
    )
  })
})
