import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CodexCommandApprovalRequestCard } from './CodexCommandApprovalRequest'

describe('CodexCommandApprovalRequestCard', () => {
  it('renders command details and forwards actions', async () => {
    const user = userEvent.setup()
    const onApprove = vi.fn()
    const onApproveYolo = vi.fn()
    const onDecline = vi.fn()
    const onCancel = vi.fn()

    render(
      <CodexCommandApprovalRequestCard
        request={{
          rpc_id: 1,
          item_id: 'item-1',
          thread_id: 'thread-1',
          turn_id: 'turn-1',
          command: 'npm test',
          cwd: '/tmp/project',
          reason: 'Run tests',
          command_actions: [
            { command: 'cat package.json', type: 'read', path: 'package.json' },
          ],
          network_approval_context: { host: 'example.com', protocol: 'https' },
        }}
        onApprove={onApprove}
        onApproveYolo={onApproveYolo}
        onDecline={onDecline}
        onCancel={onCancel}
      />
    )

    expect(screen.getByText('Run tests')).toBeInTheDocument()
    expect(screen.getByText('npm test')).toBeInTheDocument()
    expect(screen.getByText('/tmp/project')).toBeInTheDocument()
    expect(screen.getByText(/https:\/\/example\.com/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Approve' }))
    expect(onApprove).toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Approve (yolo)' }))
    expect(onApproveYolo).toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Decline' }))
    expect(onDecline).toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Cancel turn' }))
    expect(onCancel).toHaveBeenCalled()
  })
})
