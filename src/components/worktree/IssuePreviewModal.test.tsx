import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@/test/test-utils'
import { IssuePreviewModal } from './IssuePreviewModal'

vi.mock('@/lib/transport', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  invoke: vi.fn(async (command: string) => {
    if (command === 'check_gh_cli_installed') {
      return { installed: false, version: null, path: null }
    }
    throw 'Failed to run gh issue view: No such file or directory (os error 2)'
  }),
}))

vi.mock('@/services/projects', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isTauri: () => true,
}))

describe('IssuePreviewModal without GitHub CLI', () => {
  it('shows "GitHub CLI is not set up" with the setup action', async () => {
    render(
      <IssuePreviewModal
        open
        onOpenChange={vi.fn()}
        projectPath="/tmp/repo"
        type="issue"
        number={12}
      />
    )

    expect(
      await screen.findByText('GitHub CLI is not set up')
    ).toBeInTheDocument()
    expect(
      await screen.findByRole('button', { name: 'Set up GitHub CLI' })
    ).toBeInTheDocument()
    expect(screen.queryByText(/os error 2/)).not.toBeInTheDocument()
  })
})
