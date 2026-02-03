import { Plus, ChevronDown, ChevronUp, Trash2, Edit } from 'lucide-react'
import type { AppCommand } from './types'

export const worktreeCommands: AppCommand[] = [
  {
    id: 'new-worktree',
    label: 'New Worktree',
    description: 'Create a new feature branch worktree',
    icon: Plus,
    group: 'worktrees',
    shortcut: 'mod+n',
    keywords: ['worktree', 'branch', 'new', 'create', 'feature'],

    execute: context => {
      context.createWorktree()
    },

    isAvailable: context => context.hasSelectedProject(),
  },

  {
    id: 'next-worktree',
    label: 'Next Worktree',
    description: 'Switch to the next worktree',
    icon: ChevronDown,
    group: 'worktrees',
    shortcut: 'mod+alt+arrowdown',
    keywords: ['worktree', 'branch', 'next', 'switch', 'down'],

    execute: context => {
      context.nextWorktree()
    },

    isAvailable: context => context.hasActiveWorktree(),
  },

  {
    id: 'previous-worktree',
    label: 'Previous Worktree',
    description: 'Switch to the previous worktree',
    icon: ChevronUp,
    group: 'worktrees',
    shortcut: 'mod+alt+arrowup',
    keywords: ['worktree', 'branch', 'previous', 'switch', 'up'],

    execute: context => {
      context.previousWorktree()
    },

    isAvailable: context => context.hasActiveWorktree(),
  },

  {
    id: 'delete-worktree',
    label: 'Delete Worktree',
    description: 'Delete the current worktree and branch',
    icon: Trash2,
    group: 'worktrees',
    keywords: ['worktree', 'branch', 'delete', 'remove'],

    execute: context => {
      context.deleteWorktree()
    },

    isAvailable: context => context.hasActiveWorktree(),
  },

  {
    id: 'rename-worktree',
    label: 'Rename Worktree',
    description: 'Rename the current worktree branch',
    icon: Edit,
    group: 'worktrees',
    keywords: ['worktree', 'branch', 'rename', 'name'],

    execute: context => {
      context.renameWorktree()
    },

    isAvailable: context => context.hasActiveWorktree(),
  },
]
