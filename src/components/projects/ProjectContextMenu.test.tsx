import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import {
  cancelDialog,
  confirmDialog,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@/test/test-utils'
import { ProjectContextMenu } from './ProjectContextMenu'
import type { Project } from '@/types/projects'

const mocks = vi.hoisted(() => ({
  removeProjectMutate: vi.fn(),
}))

vi.mock('@/services/projects', () => {
  const mutation = () => ({ mutate: vi.fn() })
  return {
    useCreateBaseSession: mutation,
    useMoveItem: mutation,
    useOpenProjectOnGitHub: mutation,
    useOpenProjectWorktreesFolder: mutation,
    useOpenWorktreeInEditor: mutation,
    useOpenWorktreeInFinder: mutation,
    useOpenWorktreeInGitClient: mutation,
    useOpenWorktreeInTerminal: mutation,
    useRemoveProject: () => ({ mutate: mocks.removeProjectMutate }),
    useWorktrees: () => ({ data: [] }),
    useInstalledApps: () => ({ data: new Set<string>() }),
  }
})

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({ data: {} }),
}))

const project: Project = {
  id: 'project-1',
  name: 'Acme',
  path: '/tmp/acme',
  default_branch: 'main',
  added_at: 1,
  order: 0,
}

async function clickRemoveProject() {
  const user = userEvent.setup()
  render(
    <ProjectContextMenu project={project}>
      <span>project row</span>
    </ProjectContextMenu>
  )
  fireEvent.contextMenu(screen.getByText('project row'))
  await user.click(
    await screen.findByRole('menuitem', { name: /Remove Project/ })
  )
}

describe('ProjectContextMenu remove project', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not remove the project when the confirmation is cancelled', async () => {
    await clickRemoveProject()

    expect(
      await screen.findByRole('alertdialog', {
        name: 'Remove project “Acme”?',
      })
    ).toBeInTheDocument()
    await cancelDialog()

    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    )
    expect(mocks.removeProjectMutate).not.toHaveBeenCalled()
  })

  it('removes the project after confirmation', async () => {
    await clickRemoveProject()

    await screen.findByRole('alertdialog', { name: 'Remove project “Acme”?' })
    expect(mocks.removeProjectMutate).not.toHaveBeenCalled()
    await confirmDialog()

    await waitFor(() =>
      expect(mocks.removeProjectMutate).toHaveBeenCalledWith('project-1')
    )
  })
})
