import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@/test/test-utils'
import { GitInitModal, describeCommitSize } from './GitInitModal'
import { useProjectsStore } from '@/store/projects-store'
import type { GitInitPreview } from '@/types/projects'

const mocks = vi.hoisted(() => ({
  addProject: vi.fn(),
  initGit: vi.fn(),
  setIsGit: vi.fn(),
  preview: null as GitInitPreview | null,
  invoke: vi.fn(),
}))

vi.mock('@/lib/transport', () => ({
  invoke: (cmd: string, args?: unknown) => mocks.invoke(cmd, args),
}))

vi.mock('@/services/projects', () => ({
  useAddProject: () => ({ mutateAsync: mocks.addProject, isPending: false }),
  useInitGitInFolder: () => ({ mutateAsync: mocks.initGit, isPending: false }),
  useSetProjectIsGit: () => ({ mutateAsync: mocks.setIsGit, isPending: false }),
  useGitInitPreview: () => ({ data: mocks.preview, isLoading: false }),
}))

const FOLDER = '/Volumes/Work/Paperwork'

function openModal(
  choice?: 'plain' | 'git',
  projectId?: string | null,
  path = FOLDER
) {
  useProjectsStore.getState().openGitInitModal(path, choice, projectId)
}

describe('GitInitModal (#93)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.preview = {
      file_count: 12,
      total_bytes: 3 * 1024 * 1024,
      truncated: false,
      has_gitignore: false,
      sync_provider: null,
    }
    mocks.invoke.mockImplementation(async (cmd: string) =>
      cmd === 'check_git_identity'
        ? { name: 'Test', email: 'test@example.com' }
        : null
    )
    mocks.addProject.mockResolvedValue({})
    mocks.initGit.mockResolvedValue(FOLDER)
    mocks.setIsGit.mockResolvedValue({})
    useProjectsStore.setState({
      gitInitModalOpen: false,
      gitInitModalPath: null,
      addProjectDialogOpen: true,
      addProjectParentFolderId: null,
    })
  })

  it('offers both choices and adds a plain project by default', async () => {
    const user = userEvent.setup()
    openModal()
    render(<GitInitModal />)

    expect(
      screen.getByRole('radio', { name: /Add without git/ })
    ).toHaveAttribute('aria-checked', 'true')
    expect(
      screen.getByRole('radio', { name: /Initialize Git/ })
    ).toHaveAttribute('aria-checked', 'false')

    await user.click(screen.getByRole('button', { name: 'Add without git' }))

    expect(mocks.addProject).toHaveBeenCalledWith({
      path: FOLDER,
      parentId: undefined,
      plain: true,
    })
    expect(mocks.initGit).not.toHaveBeenCalled()
    expect(useProjectsStore.getState().gitInitModalOpen).toBe(false)
  })

  it('initializes git with a .gitignore and the file count, then adds the project', async () => {
    const user = userEvent.setup()
    openModal()
    render(<GitInitModal />)

    await user.click(screen.getByRole('radio', { name: /Initialize Git/ }))
    expect(screen.getByText(/for OS junk and temp files/)).toBeInTheDocument()
    expect(screen.getByTestId('git-init-file-summary')).toHaveTextContent(
      '12 files (3.0 MB)'
    )

    await user.click(screen.getByRole('button', { name: 'Initialize Git' }))

    expect(mocks.initGit).toHaveBeenCalledWith({
      path: FOLDER,
      commitAll: true,
    })
    expect(mocks.addProject).toHaveBeenCalledWith({
      path: FOLDER,
      parentId: undefined,
    })
  })

  it('makes an empty initial commit when "Commit all files now" is unticked', async () => {
    const user = userEvent.setup()
    openModal('git')
    render(<GitInitModal />)

    await user.click(screen.getByRole('checkbox'))
    expect(
      screen.getByText('Create an empty initial commit')
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Initialize Git' }))

    expect(mocks.initGit).toHaveBeenCalledWith({
      path: FOLDER,
      commitAll: false,
    })
  })

  it('warns when the folder is in a cloud-sync folder', () => {
    mocks.preview = {
      ...(mocks.preview as GitInitPreview),
      sync_provider: 'iCloud Drive',
    }
    openModal()
    render(<GitInitModal />)

    expect(screen.getByRole('alert')).toHaveTextContent(
      'This folder is in iCloud Drive'
    )
  })

  it('switches an existing plain project instead of adding it again', async () => {
    const user = userEvent.setup()
    openModal('git', 'project-1')
    render(<GitInitModal />)

    expect(
      screen.queryByRole('radio', { name: /Add without git/ })
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Initialize Git' }))

    expect(mocks.setIsGit).toHaveBeenCalledWith({
      projectId: 'project-1',
      isGit: true,
    })
    expect(mocks.addProject).not.toHaveBeenCalled()
  })

  it('describes large folders', () => {
    expect(
      describeCommitSize({
        file_count: 20000,
        total_bytes: 5 * 1024 ** 3,
        truncated: true,
        has_gitignore: true,
        sync_provider: null,
      })
    ).toBe(`more than ${(20000).toLocaleString()} files (5.0 GB)`)
    expect(
      describeCommitSize({
        file_count: 1,
        total_bytes: 10,
        truncated: false,
        has_gitignore: false,
        sync_provider: null,
      })
    ).toBe('1 file (10 B)')
  })
})
