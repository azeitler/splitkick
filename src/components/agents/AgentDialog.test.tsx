import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@/test/test-utils'
import { useUIStore } from '@/store/ui-store'
import { AgentDialog } from './AgentDialog'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  make: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@/services/agents', () => ({
  useCreateAgent: () => ({ mutateAsync: mocks.create, isPending: false }),
  useMakeSessionAgent: () => ({ mutateAsync: mocks.make, isPending: false }),
  useUpdateAgent: () => ({ mutateAsync: mocks.update, isPending: false }),
}))

vi.mock('@/services/projects', async importOriginal => ({
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  ...(await importOriginal<typeof import('@/services/projects')>()),
  useProjects: () => ({
    data: [
      { id: 'p1', name: 'Splitkick' },
      { id: 'f1', name: 'Group', is_folder: true },
      { id: 'home', name: 'assistant', hidden: true },
    ],
  }),
}))

vi.mock('@/components/graphs/role-utils', async importOriginal => ({
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports
  ...(await importOriginal<typeof import('@/components/graphs/role-utils')>()),
  useRoleProfiles: () => [{ id: 'r1', name: 'Reviewer' }],
}))

describe('AgentDialog', () => {
  beforeEach(() => {
    mocks.create.mockReset().mockResolvedValue({})
    mocks.make.mockReset().mockResolvedValue({})
    mocks.update.mockReset().mockResolvedValue({})
    useUIStore.setState({ agentDialog: null })
  })

  it('makes a session the agent of its project under the session name', async () => {
    useUIStore.setState({
      agentDialog: { mode: 'make', sessionId: 's1', sessionName: 'Releases' },
    })
    render(<AgentDialog />)
    expect(screen.getByLabelText('Name')).toHaveValue('Releases')
    await userEvent.click(screen.getByRole('button', { name: 'Make agent' }))
    expect(mocks.make).toHaveBeenCalledWith({
      sessionId: 's1',
      name: 'Releases',
      global: false,
    })
    await waitFor(() => expect(useUIStore.getState().agentDialog).toBeNull())
  })

  it('shows a taken name at the field and stays open', async () => {
    mocks.make.mockRejectedValue(
      'This project already has an agent named "Releases"'
    )
    useUIStore.setState({
      agentDialog: { mode: 'make', sessionId: 's1', sessionName: 'Releases' },
    })
    render(<AgentDialog />)
    await userEvent.click(screen.getByRole('radio', { name: /Global/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Make agent' }))
    expect(mocks.make).toHaveBeenCalledWith(
      expect.objectContaining({ global: true })
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'already has an agent named'
    )
    expect(useUIStore.getState().agentDialog).not.toBeNull()
  })

  it('creates a global agent in its default folder, or a project agent', async () => {
    useUIStore.setState({ agentDialog: { mode: 'new' } })
    render(<AgentDialog />)
    const create = screen.getByRole('button', { name: 'Create agent' })
    // No name yet.
    expect(create).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Name'), 'Assistant')
    expect(screen.getByLabelText('Folder')).toHaveAttribute(
      'placeholder',
      '~/splitkick/agents/assistant'
    )
    await userEvent.selectOptions(screen.getByLabelText('Role'), 'r1')
    await userEvent.click(create)
    expect(mocks.create).toHaveBeenCalledWith({
      name: 'Assistant',
      roleId: 'r1',
    })
  })

  it('lists only real, visible projects for a project agent', async () => {
    useUIStore.setState({ agentDialog: { mode: 'new' } })
    render(<AgentDialog />)
    await userEvent.type(screen.getByLabelText('Name'), 'Release manager')
    await userEvent.click(screen.getByRole('radio', { name: /Project/ }))
    const select = screen.getByLabelText('Project')
    expect(
      Array.from(select.querySelectorAll('option')).map(o => o.textContent)
    ).toEqual(['Splitkick'])
    await userEvent.click(screen.getByRole('button', { name: 'Create agent' }))
    expect(mocks.create).toHaveBeenCalledWith({
      name: 'Release manager',
      projectId: 'p1',
    })
  })

  it('renames an agent', async () => {
    useUIStore.setState({
      agentDialog: { mode: 'rename', agentId: 'a1', name: 'Old' },
    })
    render(<AgentDialog />)
    const name = screen.getByLabelText('Name')
    await userEvent.clear(name)
    await userEvent.type(name, 'New name')
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }))
    expect(mocks.update).toHaveBeenCalledWith({
      agentId: 'a1',
      name: 'New name',
    })
  })
})
