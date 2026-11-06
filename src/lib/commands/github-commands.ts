import {
  CircleDot,
  GitPullRequest,
  Activity,
  LayoutDashboard,
} from 'lucide-react'
import type { AppCommand, CommandContext } from './types'
import { useUIStore } from '@/store/ui-store'
import { useProjectsStore } from '@/store/projects-store'
import { isPlainProjectId, projectsQueryKeys } from '@/services/projects'
import type { Project } from '@/types/projects'

/** GitHub needs git: hidden for a plain project (#93). */
function hasSelectedGitProject(context: CommandContext): boolean {
  return (
    context.hasSelectedProject() &&
    !isPlainProjectId(useProjectsStore.getState().selectedProjectId)
  )
}

export const githubCommands: AppCommand[] = [
  {
    id: 'open-github-issues',
    label: 'Open GitHub Issues',
    description: 'View issues for current project',
    icon: CircleDot,
    group: 'github',
    keywords: ['github', 'issues', 'bugs', 'tickets'],

    execute: () => {
      const { setNewWorktreeModalDefaultTab, setNewWorktreeModalOpen } =
        useUIStore.getState()
      setNewWorktreeModalDefaultTab('issues')
      setNewWorktreeModalOpen(true)
    },
    isAvailable: hasSelectedGitProject,
  },

  {
    id: 'open-github-pull-requests',
    label: 'Open GitHub Pull Requests',
    description: 'View pull requests for current project',
    icon: GitPullRequest,
    group: 'github',
    keywords: ['github', 'pull', 'requests', 'pr', 'merge'],

    execute: () => {
      const { setNewWorktreeModalDefaultTab, setNewWorktreeModalOpen } =
        useUIStore.getState()
      setNewWorktreeModalDefaultTab('prs')
      setNewWorktreeModalOpen(true)
    },
    isAvailable: hasSelectedGitProject,
  },

  {
    id: 'open-github-workflows',
    label: 'Open GitHub Workflows',
    description: 'View workflow runs for current project',
    icon: Activity,
    group: 'github',
    keywords: [
      'github',
      'workflows',
      'actions',
      'ci',
      'cd',
      'pipelines',
      'runs',
    ],

    execute: context => {
      const { selectedProjectId } = useProjectsStore.getState()
      if (!selectedProjectId) return

      const projects = context.queryClient.getQueryData<Project[]>(
        projectsQueryKeys.list()
      )
      const project = projects?.find(p => p.id === selectedProjectId)
      if (!project) return

      const { setWorkflowRunsModalOpen } = useUIStore.getState()
      setWorkflowRunsModalOpen(true, project.path)
    },
    isAvailable: hasSelectedGitProject,
  },

  {
    id: 'open-github-dashboard',
    label: 'GitHub Dashboard',
    description: 'View issues, PRs, and security across all projects',
    icon: LayoutDashboard,
    group: 'github',
    keywords: [
      'github',
      'dashboard',
      'overview',
      'all',
      'projects',
      'issues',
      'prs',
      'security',
    ],

    execute: () => {
      useUIStore.getState().setGitHubDashboardOpen(true)
    },
    isAvailable: () => true,
  },
]
