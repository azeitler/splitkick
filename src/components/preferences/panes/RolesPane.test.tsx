import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@/test/test-utils'
import { RolesPane } from './RolesPane'

const mocks = vi.hoisted(() => ({
  patch: vi.fn(),
  profiles: [] as unknown[],
}))

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({ data: { role_profiles: mocks.profiles } }),
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

describe('RolesPane', () => {
  beforeEach(() => {
    mocks.patch.mockReset().mockResolvedValue(undefined)
    mocks.profiles = []
  })

  it('explains that a role is a session preset', () => {
    render(<RolesPane />)
    expect(
      screen.getByText(
        'A role is a session preset: persona, model and permissions. Any number of sessions can use it.'
      )
    ).toBeInTheDocument()
  })

  it('creates a new agent in role_profiles', async () => {
    render(<RolesPane />)
    await userEvent.click(screen.getByRole('button', { name: /New role/ }))
    expect(mocks.patch).toHaveBeenCalledWith({
      role_profiles: [
        expect.objectContaining({
          name: 'New role',
          permission: 'read',
          id: expect.any(String),
        }),
      ],
    })
  })

  it('offers templates while no agent exists', async () => {
    render(<RolesPane />)
    expect(screen.getByTestId('agent-templates')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Vision keeper/ }))
    const saved = mocks.patch.mock.calls[0]?.[0].role_profiles
    expect(saved).toEqual([
      expect.objectContaining({
        name: 'Vision keeper',
        permission: 'manage',
        id: expect.any(String),
        persona: expect.stringContaining('vision keeper'),
      }),
    ])
    expect(saved[0]).not.toHaveProperty('summary')
  })

  it('hides the templates once an agent exists', () => {
    mocks.profiles = [keeper]
    render(<RolesPane />)
    expect(screen.queryByTestId('agent-templates')).not.toBeInTheDocument()
  })

  it('saves edits to the selected agent', async () => {
    mocks.profiles = [keeper]
    render(<RolesPane />)
    const name = screen.getByLabelText('Name')
    await userEvent.clear(name)
    await userEvent.type(name, 'Roadmap keeper')
    await userEvent.click(screen.getByRole('radio', { name: 'write' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(mocks.patch).toHaveBeenCalledWith({
      role_profiles: [
        { ...keeper, name: 'Roadmap keeper', permission: 'write' },
      ],
    })
    expect(
      screen.getByText(/Edits reach every session with this role/)
    ).toBeInTheDocument()
  })

  it('deletes the selected agent only after the confirmation', async () => {
    mocks.profiles = [keeper]
    render(<RolesPane />)
    await userEvent.click(screen.getByRole('button', { name: /Delete/ }))
    const confirm = screen.getByRole('alertdialog')
    expect(confirm).toHaveTextContent('Delete role “Vision keeper”?')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(mocks.patch).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /Delete/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(mocks.patch).toHaveBeenCalledWith({ role_profiles: [] })
  })
})
