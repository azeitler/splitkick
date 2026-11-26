import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const invoke = vi.fn()

vi.mock('@/lib/transport', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  invoke: (...args: unknown[]) => invoke(...args),
}))

vi.mock('@/lib/environment', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hasBackendTransport: () => true,
}))

const PROJECTS = Array.from({ length: 80 }, (_, i) => `proj-${i}`)

function respond(command: string, args: { projectId: string }) {
  const worktree = {
    id: `${args.projectId}-wt`,
    project_id: args.projectId,
    path: `/tmp/${args.projectId}`,
    name: 'main',
    branch: 'main',
  }
  if (command === 'list_worktrees') return Promise.resolve([worktree])
  if (command === 'bootstrap_project')
    return Promise.resolve({ worktrees: [worktree], sessionsByWorktree: {} })
  return Promise.resolve(null)
}

function commandCounts() {
  const counts: Record<string, number> = {}
  for (const [command] of invoke.mock.calls) {
    counts[command as string] = (counts[command as string] ?? 0) + 1
  }
  return counts
}

describe('useWorktrees load per sidebar project', () => {
  beforeEach(async () => {
    invoke.mockReset()
    invoke.mockImplementation(respond)
    const { useProjectsStore } = await import('@/store/projects-store')
    useProjectsStore.setState({
      selectedProjectId: 'proj-0',
      expandedProjectIds: new Set(['proj-1']),
    })
  })

  it('bootstraps only the selected and the expanded project', async () => {
    const { useWorktrees } = await import('./projects')
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    // One hook per sidebar row, as ProjectTreeItem mounts them.
    const { result } = renderHook(() => PROJECTS.map(id => useWorktrees(id)), {
      wrapper,
    })
    await waitFor(() =>
      expect(result.current.every(q => q.isSuccess)).toBe(true)
    )

    expect(commandCounts()).toEqual({
      bootstrap_project: 2,
      list_worktrees: 78,
    })
    const bootstrapped = invoke.mock.calls
      .filter(([command]) => command === 'bootstrap_project')
      .map(([, args]) => (args as { projectId: string }).projectId)
      .sort()
    expect(bootstrapped).toEqual(['proj-0', 'proj-1'])
    expect(result.current[5]?.data).toHaveLength(1)
  })
})
