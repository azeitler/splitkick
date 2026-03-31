import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CodexMcpElicitationRequest } from './CodexMcpElicitationRequest'

describe('CodexMcpElicitationRequest', () => {
  it('parses form JSON and forwards accepted content', async () => {
    const user = userEvent.setup()
    const onAccept = vi.fn()

    render(
      <CodexMcpElicitationRequest
        request={{
          rpc_id: 1,
          server_name: 'drive',
          message: 'Please provide config',
          mode: 'form',
          requested_schema: {
            type: 'object',
            properties: { token: { type: 'string', default: 'abc' } },
          },
        }}
        onAccept={onAccept}
        onDecline={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '{"token":"xyz"}' },
    })
    await user.click(screen.getByRole('button', { name: /accept/i }))

    expect(onAccept).toHaveBeenCalledWith({ token: 'xyz' })
  })

  it('disables accept when form JSON is invalid', async () => {
    render(
      <CodexMcpElicitationRequest
        request={{
          rpc_id: 1,
          server_name: 'drive',
          message: 'Please provide config',
          mode: 'form',
          requested_schema: {
            type: 'object',
            properties: { token: { type: 'string' } },
          },
        }}
        onAccept={vi.fn()}
        onDecline={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '{invalid' },
    })

    expect(screen.getByRole('button', { name: /accept/i })).toBeDisabled()
  })
})
