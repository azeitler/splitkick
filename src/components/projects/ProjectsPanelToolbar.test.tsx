import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@/test/test-utils'
import { useProjectsStore } from '@/store/projects-store'
import type { Project } from '@/types/projects'
import { ProjectsPanelToolbar } from './ProjectsPanelToolbar'

const folder = { id: 'f1', name: 'Work', is_folder: true } as Project
const project = { id: 'p1', name: 'acme', parent_id: 'f1' } as Project

function renderToolbar(props: { newProjectDisabled?: boolean } = {}) {
  const onNewFolder = vi.fn()
  const onNewProject = vi.fn()
  render(
    <ProjectsPanelToolbar
      projects={[folder, project]}
      onNewFolder={onNewFolder}
      onNewProject={onNewProject}
      {...props}
    />
  )
  return { onNewFolder, onNewProject }
}

describe('ProjectsPanelToolbar', () => {
  beforeEach(() => {
    useProjectsStore.setState({
      expandedFolderIds: new Set(),
      expandedProjectIds: new Set(),
    })
  })

  it('expands every folder and project, then collapses them', async () => {
    const user = userEvent.setup()
    renderToolbar()

    await user.click(screen.getByRole('button', { name: 'Expand all' }))
    let state = useProjectsStore.getState()
    expect(state.expandedFolderIds).toEqual(new Set(['f1']))
    expect(state.expandedProjectIds).toEqual(new Set(['p1']))

    await user.click(screen.getByRole('button', { name: 'Collapse all' }))
    state = useProjectsStore.getState()
    expect(state.expandedFolderIds.size).toBe(0)
    expect(state.expandedProjectIds.size).toBe(0)
  })

  it('offers New project and New folder in the + menu', async () => {
    const user = userEvent.setup()
    const { onNewFolder, onNewProject } = renderToolbar()

    await user.click(
      screen.getByRole('button', { name: 'New project or folder' })
    )
    await user.click(
      await screen.findByRole('menuitem', { name: 'New project' })
    )
    expect(onNewProject).toHaveBeenCalledOnce()

    await user.click(
      screen.getByRole('button', { name: 'New project or folder' })
    )
    await user.click(
      await screen.findByRole('menuitem', { name: 'New folder' })
    )
    expect(onNewFolder).toHaveBeenCalledOnce()
  })

  it('disables New project while setup is incomplete', async () => {
    const user = userEvent.setup()
    renderToolbar({ newProjectDisabled: true })

    await user.click(
      screen.getByRole('button', { name: 'New project or folder' })
    )
    expect(
      await screen.findByRole('menuitem', { name: 'New project' })
    ).toHaveAttribute('data-disabled')
  })
})
