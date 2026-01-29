import {
  FolderOpen,
  Terminal,
  Code,
  ExternalLink,
  MoreHorizontal,
} from 'lucide-react'
import type { AppCommand } from './types'

export const openInCommands: AppCommand[] = [
  {
    id: 'open-in-finder',
    label: 'Open in Finder',
    description: 'Open the project or worktree folder in Finder',
    icon: FolderOpen,
    group: 'open-in',
    keywords: ['finder', 'folder', 'open', 'explorer', 'files'],

    execute: async context => {
      await context.openInFinder()
    },

    isAvailable: context =>
      context.hasActiveWorktree() || context.hasSelectedProject(),
  },

  {
    id: 'open-in-terminal',
    label: 'Open in Terminal',
    description: 'Open the project or worktree in your terminal app',
    icon: Terminal,
    group: 'open-in',
    keywords: ['terminal', 'shell', 'command', 'line', 'bash'],

    execute: async context => {
      await context.openInTerminal()
    },

    isAvailable: context =>
      context.hasActiveWorktree() || context.hasSelectedProject(),
  },

  {
    id: 'open-in-editor',
    label: 'Open in Editor',
    description: 'Open the project or worktree in your code editor',
    icon: Code,
    group: 'open-in',
    keywords: ['editor', 'code', 'vscode', 'cursor', 'ide'],

    execute: async context => {
      await context.openInEditor()
    },

    isAvailable: context =>
      context.hasActiveWorktree() || context.hasSelectedProject(),
  },

  {
    id: 'open-on-github',
    label: 'Open on GitHub',
    description: 'Open the project repository on GitHub',
    icon: ExternalLink,
    group: 'open-in',
    keywords: ['github', 'repository', 'repo', 'web', 'browser'],

    execute: async context => {
      await context.openOnGitHub()
    },

    isAvailable: context => context.hasSelectedProject(),
  },

  {
    id: 'open-in-modal',
    label: 'Open In...',
    description: 'Show all Open In options',
    icon: MoreHorizontal,
    group: 'open-in',
    shortcut: 'mod+o',
    keywords: ['open', 'modal', 'options'],

    execute: context => {
      context.openOpenInModal()
    },

    isAvailable: context =>
      context.hasActiveWorktree() || context.hasSelectedProject(),
  },
]
