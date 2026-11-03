import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@/test/test-utils'
import type { Project } from '@/types/projects'
import {
  NewGraphDialog,
  composeGraphPath,
  defaultRepoGraphPath,
} from './NewGraphDialog'

const mocks = vi.hoisted(() => ({
  createGraph: vi.fn(),
  openGraphView: vi.fn(),
  projects: [] as Project[],
}))

vi.mock('@/services/graphs', () => ({
  useCreateGraph: () => ({ mutateAsync: mocks.createGraph, isPending: false }),
  useOpenGraphFile: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useGraphLocationInfo: () => ({ data: undefined }),
}))
vi.mock('@/services/projects', () => ({
  useProjects: () => ({ data: mocks.projects }),
}))
vi.mock('@/lib/graph-view', () => ({ openGraphView: mocks.openGraphView }))
vi.mock('@/hooks/useDebouncedValue', () => ({
  useDebouncedValue: <T,>(value: T) => value,
}))

const project = (id: string, name: string, path: string) =>
  ({ id, name, path, default_branch: 'main', added_at: 0, order: 0 }) as Project

describe('composeGraphPath', () => {
  it('joins base and relative path with one separator', () => {
    expect(composeGraphPath('/r/', '/.splitkick/graphs/a.yml')).toBe(
      '/r/.splitkick/graphs/a.yml'
    )
    expect(composeGraphPath('/Users/me/Graphs', 'a.yml')).toBe(
      '/Users/me/Graphs/a.yml'
    )
  })

  it('is null while the form is incomplete', () => {
    expect(composeGraphPath(null, 'a.yml')).toBeNull()
    expect(composeGraphPath('/r', '  ')).toBeNull()
  })

  it('slugs the title into the default repo path', () => {
    expect(defaultRepoGraphPath('Release 1.2')).toBe(
      '.splitkick/graphs/release-1-2.yml'
    )
  })
})

describe('NewGraphDialog', () => {
  beforeEach(() => {
    mocks.createGraph.mockReset()
    mocks.openGraphView.mockClear()
    mocks.projects = [
      project('p1', 'splitkick', '/Users/me/splitkick'),
      project('p2', 'website', '/Users/me/website'),
    ]
  })

  it('creates the graph inside the chosen project repo and opens it', async () => {
    mocks.createGraph.mockResolvedValue({ id: 'new-graph' })
    const onOpenChange = vi.fn()
    render(<NewGraphDialog open onOpenChange={onOpenChange} />)

    await userEvent.type(screen.getByLabelText('Title'), 'Release 1.2')
    await userEvent.click(screen.getByRole('button', { name: 'release' }))
    await userEvent.selectOptions(screen.getByLabelText('Project'), 'p2')
    expect(screen.getByLabelText('Path in repo')).toHaveValue(
      '.splitkick/graphs/release-1-2.yml'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Create graph' }))

    expect(mocks.createGraph).toHaveBeenCalledWith({
      title: 'Release 1.2',
      graphType: 'release',
      path: '/Users/me/website/.splitkick/graphs/release-1-2.yml',
    })
    await waitFor(() =>
      expect(mocks.openGraphView).toHaveBeenCalledWith('new-graph')
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('keeps an edited path instead of following the title', async () => {
    mocks.createGraph.mockResolvedValue({ id: 'g' })
    render(<NewGraphDialog open onOpenChange={vi.fn()} />)

    await userEvent.type(screen.getByLabelText('Title'), 'Plan')
    const path = screen.getByLabelText('Path in repo')
    await userEvent.clear(path)
    await userEvent.type(path, 'graphs/plan.yaml')
    await userEvent.click(screen.getByRole('button', { name: 'Create graph' }))

    expect(mocks.createGraph).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/Users/me/splitkick/graphs/plan.yaml' })
    )
  })

  it('needs a folder before a graph outside a repo can be created', async () => {
    render(<NewGraphDialog open onOpenChange={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Title'), 'Portfolio')
    await userEvent.click(
      screen.getByRole('radio', { name: 'In a folder outside any repo' })
    )
    expect(screen.getByLabelText('File name')).toHaveValue('portfolio.yml')
    expect(screen.getByRole('button', { name: 'Create graph' })).toBeDisabled()
  })
})
