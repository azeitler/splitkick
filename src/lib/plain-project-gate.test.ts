import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it } from 'vitest'
import { isPlainProject, type Project } from '@/types/projects'
import { queryClient } from '@/lib/query-client'
import { isPlainProjectId, projectsQueryKeys } from '@/services/projects'
import { useProjectsStore } from '@/store/projects-store'
import { githubCommands } from '@/lib/commands/github-commands'
import type { CommandContext } from '@/lib/commands/types'
import { buildMagicColumns } from '@/components/magic/MagicModal'

// Plain projects (#93): one predicate gates every git feature.

const gitProject: Project = {
  id: 'git-p',
  name: 'app',
  path: '/tmp/app',
  default_branch: 'main',
  added_at: 0,
  order: 0,
}
const plainProject: Project = {
  ...gitProject,
  id: 'plain-p',
  name: 'Paperwork',
  default_branch: '',
  is_git: false,
}

describe('isPlainProject', () => {
  it('is true only for a project stored with is_git false', () => {
    expect(isPlainProject(plainProject)).toBe(true)
    // Saved before #93: no field, still a git project.
    expect(isPlainProject(gitProject)).toBe(false)
    expect(isPlainProject({ ...gitProject, is_git: true })).toBe(false)
    // A sidebar folder is not a plain project.
    expect(isPlainProject({ ...plainProject, is_folder: true })).toBe(false)
    // Loading: render as before.
    expect(isPlainProject(undefined)).toBe(false)
    expect(isPlainProject(null)).toBe(false)
  })

  it('reads the cached project list for callbacks', () => {
    queryClient.setQueryData(projectsQueryKeys.list(), [
      gitProject,
      plainProject,
    ])
    expect(isPlainProjectId('plain-p')).toBe(true)
    expect(isPlainProjectId('git-p')).toBe(false)
    expect(isPlainProjectId('unknown')).toBe(false)
    expect(isPlainProjectId(null)).toBe(false)
  })
})

describe('command palette (⌘K) GitHub commands', () => {
  const context = {
    hasSelectedProject: () => true,
    queryClient,
  } as unknown as CommandContext

  beforeEach(() => {
    queryClient.setQueryData(projectsQueryKeys.list(), [
      gitProject,
      plainProject,
    ])
  })

  it('hides the GitHub commands for a plain project', () => {
    useProjectsStore.setState({ selectedProjectId: 'plain-p' })
    for (const id of [
      'open-github-issues',
      'open-github-pull-requests',
      'open-github-workflows',
    ]) {
      const command = githubCommands.find(c => c.id === id)
      expect(command?.isAvailable?.(context), id).toBe(false)
    }
  })

  it('keeps them for a git project', () => {
    useProjectsStore.setState({ selectedProjectId: 'git-p' })
    for (const id of [
      'open-github-issues',
      'open-github-pull-requests',
      'open-github-workflows',
    ]) {
      const command = githubCommands.find(c => c.id === id)
      expect(command?.isAvailable?.(context), id).toBe(true)
    }
  })
})

describe('magic menu', () => {
  const ids = (columns: ReturnType<typeof buildMagicColumns>) =>
    columns.all.flatMap(section => section.options.map(o => o.id))

  it('keeps only session options for a plain project', () => {
    const plain = ids(buildMagicColumns(false, true))
    expect(plain).toContain('save-context')
    expect(plain).toContain('fork-session-in-place')
    for (const gitOption of [
      'commit',
      'push',
      'open-pr',
      'review',
      'merge',
      'fork-session',
      'investigate-issue',
    ]) {
      expect(plain).not.toContain(gitOption)
    }
  })

  it('is unchanged for a git project', () => {
    expect(buildMagicColumns(true, false)).toEqual(buildMagicColumns(true))
    expect(ids(buildMagicColumns(true))).toContain('commit')
    expect(ids(buildMagicColumns(true))).toContain('fork-session')
  })
})

describe('canvas and window gates (source)', () => {
  const canvas = readFileSync(
    `${process.cwd()}/src/components/dashboard/ProjectCanvasView.tsx`,
    'utf8'
  )
  const mainWindow = readFileSync(
    `${process.cwd()}/src/components/layout/MainWindow.tsx`,
    'utf8'
  )

  it('hides badges, new worktree, issues and git refresh on the canvas', () => {
    expect(canvas).toContain('const isPlain = isPlainProject(project)')
    expect(canvas).toContain('const projectBadges = isPlain ? null : (')
    expect(canvas).toContain(
      'const showIssuesColumn = showHomeColumns && !showMobileRecent && !isPlain'
    )
    expect(canvas).toContain('const mobileGitHubEnabled = isMobile && !isPlain')
    expect(canvas).toMatch(/\{!isPlain && \(\s*<DropdownMenuItem/)
  })

  it('closes the new worktree modal for a plain project and stops polling', () => {
    expect(mainWindow).toContain(
      'useRetainedMount(newWorktreeModalOpen) && !selectedProjectIsPlain'
    )
    expect(mainWindow).toContain(
      'if (!worktree || !project || isPlainProject(project)) return null'
    )
  })
})
