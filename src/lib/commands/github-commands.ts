import { GitPullRequest } from 'lucide-react'
import type { AppCommand } from './types'

export const githubCommands: AppCommand[] = [
  {
    id: 'open-pull-request',
    label: 'Open Pull Request',
    description: 'Create a new pull request for the selected worktree',
    icon: GitPullRequest,
    group: 'github',
    shortcut: 'mod+shift+p',
    keywords: ['pr', 'pull', 'request', 'github', 'merge', 'branch'],

    execute: async context => {
      await context.openPullRequest()
    },
  },
]
