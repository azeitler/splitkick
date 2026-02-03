import {
  GitCommit,
  GitCompare,
  GitMerge,
  GitPullRequest,
  Download,
  RefreshCw,
} from 'lucide-react'
import type { AppCommand } from './types'

export const gitCommands: AppCommand[] = [
  {
    id: 'commit-changes',
    label: 'Commit Changes',
    description: 'Open the commit modal to commit your changes',
    icon: GitCommit,
    group: 'git',
    shortcut: 'mod+shift+c',
    keywords: ['commit', 'git', 'save', 'changes'],

    execute: context => {
      context.openCommitModal()
    },

    isAvailable: context => context.hasActiveWorktree(),
  },

  {
    id: 'view-git-diff',
    label: 'View Git Diff',
    description: 'View uncommitted changes in the current worktree',
    icon: GitCompare,
    group: 'git',
    shortcut: 'mod+g',
    keywords: ['diff', 'git', 'changes', 'compare'],

    execute: context => {
      context.viewGitDiff()
    },

    isAvailable: context => context.hasActiveWorktree(),
  },

  {
    id: 'rebase-worktree',
    label: 'Rebase on Base',
    description: 'Rebase the current worktree onto its base branch',
    icon: GitMerge,
    group: 'git',
    keywords: ['rebase', 'git', 'merge', 'base', 'branch'],

    execute: async context => {
      await context.rebaseWorktree()
    },

    isAvailable: context => context.hasActiveWorktree(),
  },

  {
    id: 'open-pull-request',
    label: 'Open Pull Request',
    description: 'Create a new pull request for the current worktree',
    icon: GitPullRequest,
    group: 'git',
    shortcut: 'mod+shift+p',
    keywords: ['pr', 'pull', 'request', 'github', 'merge'],

    execute: async context => {
      await context.openPullRequest()
    },

    isAvailable: context => context.hasActiveWorktree(),
  },

  {
    id: 'git-pull',
    label: 'Git Pull',
    description: 'Pull changes from remote origin',
    icon: Download,
    group: 'git',
    keywords: ['pull', 'git', 'fetch', 'download', 'remote', 'sync'],

    execute: async context => {
      await context.gitPull()
    },

    isAvailable: context => context.hasActiveWorktree(),
  },

  {
    id: 'refresh-git-status',
    label: 'Refresh Git Status',
    description: 'Immediately refresh git status',
    icon: RefreshCw,
    group: 'git',
    keywords: ['refresh', 'git', 'status', 'update', 'sync'],

    execute: context => {
      context.refreshGitStatus()
    },

    isAvailable: context => context.hasActiveWorktree(),
  },
]
