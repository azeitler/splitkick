import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@/test/test-utils'
import { useUIStore } from '@/store/ui-store'
import { WorkflowRunsModal } from './WorkflowRunsModal'

vi.mock('@/lib/transport', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  invoke: vi.fn(async (command: string) => {
    if (command === 'check_gh_cli_installed') {
      return { installed: true, version: '2.1', path: '/usr/bin/gh' }
    }
    if (command === 'list_workflow_runs') {
      throw "GitHub CLI not authenticated. Run 'gh auth login' first."
    }
    return null
  }),
}))

vi.mock('@/services/projects', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isTauri: () => true,
}))

describe('WorkflowRunsModal without GitHub CLI login', () => {
  it('shows "GitHub CLI is not set up" instead of "No workflow runs found"', async () => {
    useUIStore.setState({
      workflowRunsModalOpen: true,
      workflowRunsModalProjectPath: '/tmp/repo',
      workflowRunsModalBranch: null,
    })
    render(<WorkflowRunsModal />)

    // useWorkflowRuns retries once before it reports the error
    expect(
      await screen.findByText('GitHub CLI is not set up', undefined, {
        timeout: 4000,
      })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: /Set up GitHub CLI|Sign in to GitHub/,
      })
    ).toBeInTheDocument()
    expect(screen.queryByText('No workflow runs found')).not.toBeInTheDocument()
  })
})
