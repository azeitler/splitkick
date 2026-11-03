import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@/test/test-utils'
import { AgentsPane } from './AgentsPane'

const mocks = vi.hoisted(() => ({
  patch: vi.fn(),
  profiles: [] as unknown[],
}))

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({ data: { agent_profiles: mocks.profiles } }),
  usePatchPreferences: () => ({ mutateAsync: mocks.patch, isPending: false }),
}))
vi.mock('@/services/graphs', () => ({
  useGraphs: () => ({ data: [] }),
  useGraph: () => ({ data: undefined }),
}))

const keeper = {
  id: 'a1',
  name: 'Vision keeper',
  color: '#f97316',
  persona: 'Keep the roadmap true.',
  permission: 'manage',
  backend: null,
  model: null,
  default_serves: null,
}

describe('AgentsPane', () => {
  beforeEach(() => {
    mocks.patch.mockReset().mockResolvedValue(undefined)
    mocks.profiles = []
  })

  it('creates a new agent in agent_profiles', async () => {
    render(<AgentsPane />)
    await userEvent.click(screen.getByRole('button', { name: /New agent/ }))
    expect(mocks.patch).toHaveBeenCalledWith({
      agent_profiles: [
        expect.objectContaining({
          name: 'New agent',
          permission: 'read',
          id: expect.any(String),
        }),
      ],
    })
  })

  it('saves edits to the selected agent', async () => {
    mocks.profiles = [keeper]
    render(<AgentsPane />)
    const name = screen.getByLabelText('Name')
    await userEvent.clear(name)
    await userEvent.type(name, 'Roadmap keeper')
    await userEvent.click(screen.getByRole('radio', { name: 'write' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(mocks.patch).toHaveBeenCalledWith({
      agent_profiles: [
        { ...keeper, name: 'Roadmap keeper', permission: 'write' },
      ],
    })
    expect(
      screen.getByText(/Edits apply to sessions started after saving/)
    ).toBeInTheDocument()
  })

  it('deletes the selected agent', async () => {
    mocks.profiles = [keeper]
    render(<AgentsPane />)
    await userEvent.click(screen.getByRole('button', { name: /Delete/ }))
    expect(mocks.patch).toHaveBeenCalledWith({ agent_profiles: [] })
  })
})
